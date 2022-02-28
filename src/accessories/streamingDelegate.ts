/* eslint-disable indent */
import {
    API,
    APIEvent,
    AudioStreamingCodecType,
    AudioStreamingSamplerate,
    CameraController,
    CameraControllerOptions,
    CameraStreamingDelegate,
    HAP,
    PrepareStreamCallback,
    PrepareStreamRequest,
    PrepareStreamResponse,
    SnapshotRequest,
    SnapshotRequestCallback,
    SRTPCryptoSuites,
    StartStreamRequest,
    StreamingRequest,
    StreamRequestCallback,
    StreamRequestTypes,
    VideoInfo
} from 'homebridge';
import { spawn } from 'child_process';
import { createSocket, Socket } from 'dgram';
import ffmpegPath from 'ffmpeg-for-homebridge';
import pickPort, { pickPortOptions } from 'pick-port';
import { CameraConfig, VideoConfig } from './configTypes';
import { FfmpegProcess } from './ffmpeg';
import { Logger } from './logger';

import { Station, Camera, PropertyName, StreamMetadata, VideoCodec } from 'eufy-security-client';
import { EufySecurityPlatform } from '../platform';

import { Readable } from 'stream';
import { NamePipeStream, StreamInput } from './UniversalStream';

import { readFile } from 'fs';
import path from 'path';
import { promisify } from 'util';
const readFileAsync = promisify(readFile),
    SnapshotUnavailablePath = require.resolve('../../media/Snapshot-Unavailable.png');

const offlineImage = path.resolve(__dirname, '..', 'media', 'offline_cameraui.png');
const privacyImage = path.resolve(__dirname, '..', 'media', 'privacy_cameraui.png');

type SessionInfo = {
    address: string; // address of the HAP controller
    ipv6: boolean;

    videoPort: number;
    videoReturnPort: number;
    videoCryptoSuite: SRTPCryptoSuites; // should be saved if multiple suites are supported
    videoSRTP: Buffer; // key and salt concatenated
    videoSSRC: number; // rtp synchronisation source

    audioPort: number;
    audioReturnPort: number;
    audioCryptoSuite: SRTPCryptoSuites;
    audioSRTP: Buffer;
    audioSSRC: number;
};

type ResolutionInfo = {
    width: number;
    height: number;
    videoFilter?: string;
    snapFilter?: string;
    resizeFilter?: string;
};

type ActiveSession = {
    mainProcess?: FfmpegProcess;
    timeout?: NodeJS.Timeout;
    vsocket?: Socket;
    asocket?: Socket;
    uVideoStream?: NamePipeStream;
    uAudioStream?: NamePipeStream;

};

type StationStream = {
    station: Station;
    channel: number;
    metadata: StreamMetadata;
    videostream: Readable;
    audiostream: Readable;
};

export class StreamingDelegate implements CameraStreamingDelegate {
    private readonly hap: HAP;
    private readonly api: API;
    private readonly log: Logger;
    private readonly cameraName: string;
    private readonly unbridge: boolean;
    private readonly videoConfig: VideoConfig;
    private readonly videoProcessor: string;
    readonly controller: CameraController;
    private snapshotPromise?: Promise<Buffer>;
    private stationStream: StationStream | undefined;

    private readonly platform: EufySecurityPlatform;
    private readonly device: Camera;

    // keep track of sessions
    pendingSessions: Map<string, SessionInfo> = new Map();
    ongoingSessions: Map<string, ActiveSession> = new Map();
    timeouts: Map<string, NodeJS.Timeout> = new Map();

    constructor(platform: EufySecurityPlatform, device: Camera, cameraConfig: CameraConfig, api: API, hap: HAP) { // eslint-disable-line @typescript-eslint/explicit-module-boundary-types
        this.log = platform.log;
        this.hap = hap;
        this.api = api;

        this.platform = platform;
        this.device = device;

        this.cameraName = device.getName()!;
        this.unbridge = false;
        this.videoConfig = cameraConfig.videoConfig!;
        this.videoProcessor = ffmpegPath || 'ffmpeg';

        this.api.on(APIEvent.SHUTDOWN, () => {
            for (const session in this.ongoingSessions) {
                this.stopStream(session);
            }
        });

        const options: CameraControllerOptions = {
            cameraStreamCount: this.videoConfig.maxStreams || 2, // HomeKit requires at least 2 streams, but 1 is also just fine
            delegate: this,
            streamingOptions: {
                supportedCryptoSuites: [hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
                video: {
                    resolutions: [
                        [320, 180, 30],
                        [320, 240, 15], // Apple Watch requires this configuration
                        [320, 240, 30],
                        [480, 270, 30],
                        [480, 360, 30],
                        [640, 360, 30],
                        [640, 480, 30],
                        [1280, 720, 30],
                        [1280, 960, 30],
                        [1920, 1080, 30],
                        [1600, 1200, 30]
                    ],
                    codec: {
                        profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
                        levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0]
                    }
                },
                audio: {
                    twoWayAudio: !!this.videoConfig.returnAudioTarget,
                    codecs: [
                        {
                            type: AudioStreamingCodecType.AAC_ELD,
                            samplerate: AudioStreamingSamplerate.KHZ_16
                            /*type: AudioStreamingCodecType.OPUS,
                            samplerate: AudioStreamingSamplerate.KHZ_24*/
                        }
                    ]
                }
            }
        };

        this.controller = new hap.CameraController(options);
    }

    private determineResolution(request: SnapshotRequest | VideoInfo, isSnapshot: boolean): ResolutionInfo {
        const resInfo: ResolutionInfo = {
            width: request.width,
            height: request.height
        };
        if (!isSnapshot) {
            if (this.videoConfig.maxWidth !== undefined &&
                (this.videoConfig.forceMax || request.width > this.videoConfig.maxWidth)) {
                resInfo.width = this.videoConfig.maxWidth;
            }
            if (this.videoConfig.maxHeight !== undefined &&
                (this.videoConfig.forceMax || request.height > this.videoConfig.maxHeight)) {
                resInfo.height = this.videoConfig.maxHeight;
            }
        }

        const filters: Array<string> = this.videoConfig.videoFilter?.split(',') || [];
        const noneFilter = filters.indexOf('none');
        if (noneFilter >= 0) {
            filters.splice(noneFilter, 1);
        }
        resInfo.snapFilter = filters.join(',');
        if ((noneFilter < 0) && (resInfo.width > 0 || resInfo.height > 0)) {
            resInfo.resizeFilter = 'scale=' + (resInfo.width > 0 ? '\'min(' + resInfo.width + ',iw)\'' : 'iw') + ':' +
                (resInfo.height > 0 ? '\'min(' + resInfo.height + ',ih)\'' : 'ih') +
                ':force_original_aspect_ratio=decrease';
            filters.push(resInfo.resizeFilter);
            filters.push('scale=\'trunc(iw/2)*2:trunc(ih/2)*2\''); // Force to fit encoder restrictions
        }

        if (filters.length > 0) {
            resInfo.videoFilter = filters.join(',');
        }

        return resInfo;
    }

    private async getLocalLiveStream(): Promise<StationStream> {
        return new Promise((resolve, reject) => {
            const station = this.platform.getStationById(this.device.getStationSerial());
            this.platform.eufyClient.startStationLivestream(this.device.getSerial());

            station.on('livestream start', (station: Station, channel: number, metadata: StreamMetadata,
                videostream: Readable, audiostream: Readable) => {
                if (this.platform.eufyClient.getStationDevice(station.getSerial(), channel).getSerial() === this.device.getSerial()) {
                    const stationStream: StationStream = { station, channel, metadata, videostream, audiostream };
                    this.stationStream = stationStream;
                    resolve(stationStream);
                }
            });
        });
    }

    fetchSnapshot(snapFilter?: string): Promise<Buffer> {

        return new Promise(async (resolve, reject) => {

            try {
                // try {
                //     this.videoConfig.stillImageSource = '-i ' + this.device.getPropertyValue(PropertyName.DevicePictureUrl).value as string;
                // } catch {
                //     this.log.warn(this.cameraName + ' fetchSnapshot: ' + 'No Snapshot found');
                //     resolve(await readFileAsync(SnapshotUnavailablePath));
                // }


                // const ffmpegArgs = (this.videoConfig.stillImageSource || this.videoConfig.source!) + // Still
                // ' -frames:v 1' +
                // (snapFilter ? ' -filter:v ' + snapFilter : '') +
                // ' -f image2 -' +
                // ' -hide_banner' +
                // ' -loglevel ' + (this.platform.config.enableDetailedLogging >= 1 ? '+verbose' : 'error');

                const streamData = await this.getLocalLiveStream().catch(err => {
                    throw err;
                });

                this.log.debug('Received local livestream.');

                const startTime = Date.now();
                const ffmpegArgs = '-probesize 3000 -analyzeduration 0 -ss 00:00:00.500 -i pipe: -frames:v 1 -c:v copy' +
                    (snapFilter ? ' -filter:v ' + snapFilter : '') +
                    ' -f image2 -' +
                    ' -hide_banner' +
                    ' -loglevel ' + (this.platform.config.enableDetailedLogging >= 1 ? '+verbose' : 'error');

                this.log.debug(this.cameraName, 'Snapshot command: ' + this.videoProcessor + ' ' + ffmpegArgs, this.videoConfig.debug);
                const ffmpeg = spawn(this.videoProcessor, ffmpegArgs.split(/\s+/), { env: process.env });
                streamData.videostream.pipe(ffmpeg.stdin).on('error', (err) => {
                    this.log.error(err.message, this.cameraName);
                });

                let snapshotBuffer = Buffer.alloc(0);
                ffmpeg.stdout.on('data', (data) => {
                    snapshotBuffer = Buffer.concat([snapshotBuffer, data]);
                });
                ffmpeg.on('error', (error: Error) => {
                    reject('FFmpeg process creation failed: ' + error.message);
                });
                ffmpeg.stderr.on('data', (data) => {
                    data.toString().split('\n').forEach((line: string) => {
                        if (this.videoConfig.debug && line.length > 0) { // For now only write anything out when debug is set
                            this.log.error(line, this.cameraName + '] [Snapshot');
                        }
                    });
                });
                ffmpeg.on('close', () => {
                    if (snapshotBuffer.length > 0) {
                        resolve(snapshotBuffer);
                    } else {
                        reject('Failed to fetch snapshot.');
                    }

                    this.platform.eufyClient.stopStationLivestream(this.device.getSerial());

                    setTimeout(() => {
                        this.log.debug('Setting snapshotPromise to undefined.');
                        this.snapshotPromise = undefined;
                    }, 3 * 1000); // Expire cached snapshot after 3 seconds

                    const runtime = (Date.now() - startTime) / 1000;
                    let message = 'Fetching snapshot took ' + runtime + ' seconds.';
                    if (runtime < 5) {
                        this.log.debug(message, this.cameraName, this.videoConfig.debug);
                    } else {
                        if (!this.unbridge) {
                            message += ' It is highly recommended you switch to unbridge mode.';
                        }
                        if (runtime < 22) {
                            this.log.warn(message, this.cameraName);
                        } else {
                            message += ' The request has timed out and the snapshot has not been refreshed in HomeKit.';
                            this.log.error(message, this.cameraName);
                        }
                    }
                });
            } catch (err) {
                this.log.error(this.cameraName, err as string);
                reject('Failed to fetch snapshot.');
            }
        });
    }

    resizeSnapshot(snapshot: Buffer, resizeFilter?: string): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            const ffmpegArgs = '-i pipe:' + // Resize
                ' -frames:v 1' +
                (resizeFilter ? ' -filter:v ' + resizeFilter : '') +
                ' -f image2 -';

            this.log.debug(this.cameraName, 'Resize command: ' + this.videoProcessor + ' ' + ffmpegArgs, this.videoConfig.debug);
            const ffmpeg = spawn(this.videoProcessor, ffmpegArgs.split(/\s+/), { env: process.env });

            let resizeBuffer = Buffer.alloc(0);
            ffmpeg.stdout.on('data', (data) => {
                resizeBuffer = Buffer.concat([resizeBuffer, data]);
            });
            ffmpeg.on('error', (error: Error) => {
                reject('FFmpeg process creation failed: ' + error.message);
            });
            ffmpeg.on('close', () => {
                resolve(resizeBuffer);
            });
            ffmpeg.stdin.end(snapshot);
        });
    }

    async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
        this.log.debug('handleSnapshotRequest');
        this.log.debug('snapshotPromise: ' + !!this.snapshotPromise);
        const resolution = this.determineResolution(request, true);

        try {
            const cachedSnapshot = !!this.snapshotPromise;

            this.log.debug('Snapshot requested: ' + request.width + ' x ' + request.height,
                this.cameraName, this.videoConfig.debug);

            const snapshot = await (this.snapshotPromise || this.fetchSnapshot(resolution.snapFilter));
            // let snapshot;
            // if(this.snapshotPromise) {
            //     this.log.debug('Awaiting promise');
            //     snapshot = await this.snapshotPromise;
            // } else{
            //     this.log.debug('Calling fetchSnapshot');
            //     snapshot = await this.fetchSnapshot(resolution.snapFilter);
            // }

            this.log.debug('snapshot byte lenght: ' + snapshot?.byteLength);

            this.log.debug('Sending snapshot: ' + (resolution.width > 0 ? resolution.width : 'native') + ' x ' +
                (resolution.height > 0 ? resolution.height : 'native') +
                (cachedSnapshot ? ' (cached)' : ''), this.cameraName, this.videoConfig.debug);

            const resized = await this.resizeSnapshot(snapshot, resolution.resizeFilter);
            callback(undefined, resized);
        } catch (err) {
            this.log.error(this.cameraName, err as string);
            callback();
        }
    }

    async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
        const ipv6 = request.addressVersion === 'ipv6';

        const options: pickPortOptions = {
            type: 'udp',
            ip: ipv6 ? '::' : '0.0.0.0',
            reserveTimeout: 15
        };
        const videoReturnPort = await pickPort(options);
        const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
        const audioReturnPort = await pickPort(options);
        const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

        const sessionInfo: SessionInfo = {
            address: request.targetAddress,
            ipv6: ipv6,

            videoPort: request.video.port,
            videoReturnPort: videoReturnPort,
            videoCryptoSuite: request.video.srtpCryptoSuite,
            videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
            videoSSRC: videoSSRC,

            audioPort: request.audio.port,
            audioReturnPort: audioReturnPort,
            audioCryptoSuite: request.audio.srtpCryptoSuite,
            audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
            audioSSRC: audioSSRC
        };

        const response: PrepareStreamResponse = {
            video: {
                port: videoReturnPort,
                ssrc: videoSSRC,

                srtp_key: request.video.srtp_key,
                srtp_salt: request.video.srtp_salt
            },
            audio: {
                port: audioReturnPort,
                ssrc: audioSSRC,

                srtp_key: request.audio.srtp_key,
                srtp_salt: request.audio.srtp_salt
            }
        };

        this.pendingSessions.set(request.sessionID, sessionInfo);
        callback(undefined, response);
    }

    private generateVideoConfig(videoConfig) {
        const config = { ...videoConfig };

        config.maxWidth = config.maxWidth || 1280;
        config.maxHeight = config.maxHeight || 720;
        config.maxFPS = config.maxFPS >= 20 ? videoConfig.maxFPS : 30;
        config.maxStreams = config.maxStreams >= 1 ? videoConfig.maxStreams : 2;
        config.maxBitrate = config.maxBitrate || 299;
        config.vcodec = config.vcodec || 'libx264';
        config.acodec = config.acodec || 'libfdk_aac';
        config.encoderOptions = config.encoderOptions || '-preset ultrafast -tune zerolatency';
        config.packetSize = config.packetSize || 1128;

        return config;
    }

    private generateInputSource(videoConfig, source) {
        let inputSource = source || videoConfig.source;

        if (inputSource) {
            if (videoConfig.readRate && !inputSource.includes('-re')) {
                inputSource = `-re ${inputSource}`;
            }

            if (videoConfig.stimeout > 0 && !inputSource.includes('-stimeout')) {
                inputSource = `-stimeout ${videoConfig.stimeout * 10000000} ${inputSource}`;
            }

            if (videoConfig.maxDelay >= 0 && !inputSource.includes('-max_delay')) {
                inputSource = `-max_delay ${videoConfig.maxDelay} ${inputSource}`;
            }

            if (videoConfig.reorderQueueSize >= 0 && !inputSource.includes('-reorder_queue_size')) {
                inputSource = `-reorder_queue_size ${videoConfig.reorderQueueSize} ${inputSource}`;
            }

            if (videoConfig.probeSize >= 32 && !inputSource.includes('-probesize')) {
                inputSource = `-probesize ${videoConfig.probeSize} ${inputSource}`;
            }

            if (videoConfig.analyzeDuration >= 0 && !inputSource.includes('-analyzeduration')) {
                inputSource = `-analyzeduration ${videoConfig.analyzeDuration} ${inputSource}`;
            }

            if (videoConfig.rtspTransport && !inputSource.includes('-rtsp_transport')) {
                inputSource = `-rtsp_transport ${videoConfig.rtspTransport} ${inputSource}`;
            }
        }

        return inputSource;
    }

    private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {

        const sessionInfo = this.pendingSessions.get(request.sessionID);

        if (sessionInfo) {
            let inputChanged = false;
            let prebufferInput = true;
            let uVideoStream;
            let uAudioStream;
            let ffmpegInput;

            const videoConfig = this.generateVideoConfig(this.videoConfig);

            if (false) {
                ffmpegInput = ['-re', '-loop', '1', '-i', offlineImage];
                inputChanged = true;
            } else if (false) {
                ffmpegInput = ['-re', '-loop', '1', '-i', privacyImage];
                inputChanged = true;
            } else {
                try {
                    const streamData = await this.getLocalLiveStream().catch(err => {
                        throw err;
                    });
                    uVideoStream = StreamInput(streamData.videostream, this.cameraName + '_video', this.platform.eufyPath, this.log);
                    uAudioStream = StreamInput(streamData.audiostream, this.cameraName + '_audio', this.platform.eufyPath, this.log);
                    ffmpegInput = this.generateInputSource(videoConfig, '-i ' + uVideoStream.url).split(/\s+/);
                } catch (err) {
                    this.log.error(this.cameraName + ' Unable to start the livestream: ' + err as string);
                }
            }

            const resolution = this.determineResolution(request.video, false);
            const vcodec = this.videoConfig.vcodec || 'libx264';
            const mtu = this.videoConfig.packetSize || 1128; // request.video.mtu is not used

            let fps = videoConfig.maxFPS && videoConfig.forceMax ? videoConfig.maxFPS : request.video.fps;
            let videoBitrate =
                videoConfig.maxBitrate && videoConfig.forceMax ? videoConfig.maxBitrate : request.video.max_bit_rate;
            let bufsize = request.video.max_bit_rate * 2;
            let maxrate = request.video.max_bit_rate;
            let encoderOptions = videoConfig.encoderOptions;

            if (vcodec === 'copy') {
                resolution.width = 0;
                resolution.height = 0;
                resolution.videoFilter = undefined;
                fps = 0;
                videoBitrate = 0;
                bufsize = 0;
                maxrate = 0;
                encoderOptions = undefined;
            }

            const resolutionText =
                vcodec === 'copy'
                    ? 'native'
                    : `${resolution.width}x${resolution.height}, ${fps} fps, ${videoBitrate} kbps ${videoConfig.audio ? ' (' + request.audio.codec + ')' : ''
                    }`;

            this.log.info(this.cameraName, `Starting video stream: ${resolutionText}`);

            let ffmpegArgs = [
                '-hide_banner',
                '-loglevel',
                `level${this.videoConfig.debug ? '+verbose' : ''}`,
                '-use_wallclock_as_timestamps 1',
                ...ffmpegInput,
            ];

            // ffmpegArgs.push('-use_wallclock_as_timestamps 1');

            if (!inputChanged && !prebufferInput && videoConfig.mapvideo) {
                ffmpegArgs.push('-map', videoConfig.mapvideo);
            } else {
                ffmpegArgs.push('-an', '-sn', '-dn');
            }

            if (fps) {
                ffmpegArgs.push('-r', fps);
            }

            ffmpegArgs.push(
                '-vcodec',
                inputChanged ? (vcodec === 'copy' ? 'libx264' : vcodec) : vcodec,
                '-pix_fmt',
                'yuv420p',
                '-color_range',
                'mpeg',
                '-f',
                'rawvideo'
            );

            if (encoderOptions) {
                ffmpegArgs.push(...encoderOptions.split(/\s+/));
            }

            if (resolution.videoFilter) {
                ffmpegArgs.push('-filter:v', ...resolution.videoFilter.split(/\s+/));
            }

            if (videoBitrate > 0) {
                ffmpegArgs.push('-b:v', `${videoBitrate}k`);
            }

            if (bufsize > 0) {
                ffmpegArgs.push('-bufsize', `${bufsize}k`);
            }

            if (maxrate > 0) {
                ffmpegArgs.push('-maxrate', `${maxrate}k`);
            }

            ffmpegArgs.push( // Video Stream
                '-payload_type ' + request.video.pt,
                '-ssrc ' + sessionInfo.videoSSRC,
                '-f rtp',
                '-srtp_out_suite AES_CM_128_HMAC_SHA1_80',
                '-srtp_out_params ' + sessionInfo.videoSRTP.toString('base64'),
                'srtp://' + sessionInfo.address + ':' + sessionInfo.videoPort +
                '?rtcpport=' + sessionInfo.videoPort + '&pkt_size=' + mtu,
            );

            if (request.audio.codec === AudioStreamingCodecType.OPUS || request.audio.codec === AudioStreamingCodecType.AAC_ELD) {
                ffmpegArgs.push(`-i ${uAudioStream.url}`);

                ffmpegArgs.push( // Audio
                    (this.videoConfig.mapaudio ? '-map ' + this.videoConfig.mapaudio : '-vn -sn -dn'),
                    (request.audio.codec === AudioStreamingCodecType.OPUS ?
                        '-codec:a libopus' + ' -application lowdelay' :
                        '-codec:a libfdk_aac' + ' -profile:a aac_eld'),
                    '-flags +global_header',
                    '-ar ' + request.audio.sample_rate + 'k',
                    '-b:a ' + request.audio.max_bit_rate + 'k',
                    '-ac ' + request.audio.channel,
                    '-payload_type ' + request.audio.pt,
                );

                ffmpegArgs.push( // Audio Stream
                    '-ssrc ' + sessionInfo.audioSSRC,
                    '-f rtp',
                    '-srtp_out_suite AES_CM_128_HMAC_SHA1_80',
                    '-srtp_out_params ' + sessionInfo.audioSRTP.toString('base64'),
                    'srtp://' + sessionInfo.address + ':' + sessionInfo.audioPort +
                    '?rtcpport=' + sessionInfo.audioPort + '&pkt_size=188',
                );

            } else {
                this.log.error(this.cameraName, 'Unsupported audio codec requested: ' + request.audio.codec);
            }

            ffmpegArgs.push('-progress pipe:1');

            const clean_ffmpegArgs = ffmpegArgs.filter(function (el) { return el; });

            const activeSession: ActiveSession = {};

            activeSession.vsocket = createSocket(sessionInfo.ipv6 ? 'udp6' : 'udp4');
            activeSession.vsocket.on('error', (err: Error) => {
                this.log.error(this.cameraName, 'Socket error: ' + err.message);
                this.stopStream(request.sessionID);
            });
            activeSession.vsocket.on('message', () => {
                if (activeSession.timeout) {
                    clearTimeout(activeSession.timeout);
                }
                activeSession.timeout = setTimeout(() => {
                    this.log.debug(this.cameraName, 'Device appears to be inactive. Stopping video stream.');
                    this.controller.forceStopStreamingSession(request.sessionID);
                    this.stopStream(request.sessionID);
                }, request.video.rtcp_interval * 5 * 1000);
            });
            activeSession.vsocket.bind(sessionInfo.videoReturnPort);

            activeSession.uVideoStream = uVideoStream;
            activeSession.uAudioStream = uAudioStream;

            activeSession.mainProcess = new FfmpegProcess(this.cameraName, request.sessionID, this.videoProcessor,
                clean_ffmpegArgs, this.log, this.videoConfig.debug, this, callback);

            // streamData.station.on('livestream stop', (station: Station, channel: number) => {
            //     if (this.platform.eufyClient.getStationDevice(station.getSerial(), channel).getSerial() === this.device.getSerial()) {
            //         this.log.info(this.cameraName, 'Eufy Station stopped the stream. Stopping stream.');
            //         this.controller.forceStopStreamingSession(request.sessionID);
            //         this.stopStream(request.sessionID);
            //     }
            // });

            // Check if the pendingSession has been stopped before it was successfully started.
            const pendingSession = this.pendingSessions.get(request.sessionID);
            // pendingSession has not been deleted. Transfer it to ongoingSessions.
            if (pendingSession) {
                this.ongoingSessions.set(request.sessionID, activeSession);
                this.pendingSessions.delete(request.sessionID);
            }
            // pendingSession has been deleted. Add it to ongoingSession and end it immediately.
            else {
                this.ongoingSessions.set(request.sessionID, activeSession);
                this.log.info(this.cameraName, 'pendingSession has been deleted. Add it to ongoingSession and end it immediately.');
                this.stopStream(request.sessionID);
            }
        } else {
            this.log.error(this.cameraName, 'Error finding session information.');
            callback(new Error('Error finding session information'));
        }
    }

    handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
        switch (request.type) {
            case StreamRequestTypes.START:
                this.startStream(request, callback);
                break;
            case StreamRequestTypes.RECONFIGURE:
                this.log.debug(this.cameraName, 'Received request to reconfigure: ' + request.video.width + ' x ' + request.video.height + ', ' +
                    request.video.fps + ' fps, ' + request.video.max_bit_rate + ' kbps (Ignored)', this.videoConfig.debug);
                callback();
                break;
            case StreamRequestTypes.STOP:
                this.log.debug(this.cameraName, 'Receive Apple HK Stop request' + JSON.stringify(request));
                this.stopStream(request.sessionID);
                callback();
                break;
        }
    }

    public stopStream(sessionId: string): void {
        this.log.debug('Stopping session with id: ' + sessionId);

        const pendingSession = this.pendingSessions.get(sessionId);
        if (pendingSession) {
            this.pendingSessions.delete(sessionId);
        }

        const session = this.ongoingSessions.get(sessionId);
        if (session) {
            if (session.timeout) {
                clearTimeout(session.timeout);
            }
            try {
                session.mainProcess?.stop();
            } catch (err) {
                this.log.error(this.cameraName, 'Error occurred terminating main FFmpeg process: ' + err);
            }
            try {
                session.vsocket?.close();
                session.asocket?.close();
            } catch (err) {
                this.log.error(this.cameraName, 'Error occurred closing socket: ' + err);
            }
            try {
                session.uVideoStream?.close();
                session.uAudioStream?.close();
            } catch (err) {
                this.log.error(this.cameraName, 'Error occurred Universal Stream: ' + err);
            }
            try {
                this.platform.eufyClient.stopStationLivestream(this.device.getSerial());
            } catch (err) {
                this.log.error(this.cameraName, 'Error occurred terminating Eufy Station livestream: ' + err);
            }

            this.ongoingSessions.delete(sessionId);
            this.log.info(this.cameraName, 'Stopped video stream.');
        }
        else {
            this.log.debug('No session to stop.')
        }

    }
}
