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

import { Station, Device, Camera, PropertyName, StreamMetadata, VideoCodec } from 'eufy-security-client';
import { EufySecurityPlatform } from '../platform';

import { Readable } from 'stream';
import { NamePipeStream, StreamInput } from './UniversalStream';
import { LocalLivestreamCache } from './LocalLivestreamCache';

import { readFile } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { json } from 'stream/consumers';
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
    videoProcess?: FfmpegProcess;
    audioProcess?: FfmpegProcess;
    timeout?: NodeJS.Timeout;
    socket?: Socket;
    uVideoStream?: NamePipeStream;
    uAudioStream?: NamePipeStream;
    cachedStreamId?: number;
};

export class StreamingDelegate implements CameraStreamingDelegate {
    private readonly hap: HAP;
    private readonly api: API;
    private readonly log: Logger;
    private readonly cameraName: string;
    private cameraConfig: CameraConfig;
    private videoConfig: VideoConfig;
    private readonly videoProcessor: string;
    readonly controller: CameraController;
    private snapshotPromise?: Promise<Buffer>;

    private readonly platform: EufySecurityPlatform;
    private readonly device: Camera;

    private localLivestreamCache: LocalLivestreamCache;

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

        this.localLivestreamCache = new LocalLivestreamCache(this.platform, this.device, this.log);

        this.cameraName = device.getName()!;

        this.cameraConfig = cameraConfig;
        this.videoConfig = cameraConfig.videoConfig!;
        this.videoProcessor = ffmpegPath || 'ffmpeg';

        this.api.on(APIEvent.SHUTDOWN, () => {
            for (const session in this.ongoingSessions) {
                this.stopStream(session);
            }
            this.localLivestreamCache.stopLocalLiveStream();
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

    fetchSnapshot(snapFilter?: string): Promise<Buffer> {

        return new Promise(async (resolve, reject) => {

            let inputChanged = false;
            let uVideoStream;
            let ffmpegInput;

            const rtsp = this.is_rtsp_ready();

            let livestreamIdToRelease: number | null = null;

            try {

                if (false) {
                    ffmpegInput = ['-re', '-loop', '1', '-i', offlineImage];
                    inputChanged = true;
                } else if (false) {
                    ffmpegInput = ['-re', '-loop', '1', '-i', privacyImage];
                    inputChanged = true;
                } else if (!this.cameraConfig.forcerefreshsnap) {
                    try {
                        const url = this.device.getPropertyValue(PropertyName.DevicePictureUrl) as string;
                        this.videoConfig.stillImageSource = '-i ' + url;
                        this.platform.log.debug(this.cameraName, 'EUFY CLOUD URL: ' + url);
                    } catch {
                        this.log.warn(this.cameraName + ' fetchSnapshot: ' + 'No Snapshot found');
                        resolve(await readFileAsync(SnapshotUnavailablePath));
                    }
                } else if (rtsp) {
                    try {
                        const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
                        this.platform.log.debug(this.cameraName, 'RTSP URL: ' + url);
                        this.videoConfig.source = '-i ' + url;
                        ffmpegInput = this.generateInputSource(this.videoConfig, this.videoConfig.source).split(/\s+/);
                    } catch {
                        this.log.warn(this.cameraName + ' fetchSnapshot: ' + 'No Snapshot found');
                        resolve(await readFileAsync(SnapshotUnavailablePath));
                    }
                } else {
                    try {
                        const streamData = await this.localLivestreamCache.getLocalLivestream().catch(err => {
                            throw err;
                        });
                        livestreamIdToRelease = streamData.id;
                        uVideoStream = StreamInput(streamData.videostream, this.cameraName + '_video', this.platform.eufyPath, this.log);
                        this.videoConfig.source = '-i ' + uVideoStream.url;
                        ffmpegInput = this.generateInputSource(this.videoConfig, this.videoConfig.source).split(/\s+/);

                    } catch (err) {
                        this.log.error(this.cameraName + ' Unable to start the livestream: ' + err as string);
                        resolve(await readFileAsync(SnapshotUnavailablePath));
                    }
                }

                this.videoConfig = this.generateVideoConfigSnapShot(this.videoConfig);

                const startTime = Date.now();
                const ffmpegArgs = (this.videoConfig.stillImageSource || this.videoConfig.source!) + // Still
                    ' -frames:v 1' +
                    (snapFilter ? ' -filter:v ' + snapFilter : '') +
                    ' -f image2 -' +
                    ' -hide_banner' +
                    ' -loglevel error';

                this.log.debug(this.cameraName, 'Snapshot command: ' + this.videoProcessor + ' ' + ffmpegArgs, this.videoConfig.debug);
                const ffmpeg = spawn(this.videoProcessor, ffmpegArgs.split(/\s+/), { env: process.env });

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

                    if (livestreamIdToRelease !== null) {
                        this.localLivestreamCache.stopCachedStream(livestreamIdToRelease);
                    }

                    setTimeout(() => {
                        this.log.debug('Setting snapshotPromise to undefined.');
                        this.snapshotPromise = undefined;
                    }, 3 * 1000); // Expire cached snapshot after 3 seconds

                    const runtime = (Date.now() - startTime) / 1000;
                    let message = 'Fetching snapshot took ' + runtime + ' seconds.';
                    if (runtime < 5) {
                        this.log.debug(message, this.cameraName, this.videoConfig.debug);
                    } else {
                        if (!this.cameraConfig.unbridge) {
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

    private generateVideoConfigSnapShot(videoConfig) {
        const config = { ...videoConfig };

        config.maxWidth = config.maxWidth || 640;
        config.maxHeight = config.maxHeight || 480;
        config.maxFPS = config.maxFPS >= 4 ? videoConfig.maxFPS : 10;
        config.maxStreams = config.maxStreams >= 2 ? videoConfig.maxStreams : 2;
        config.maxBitrate = config.maxBitrate || 99;
        config.vcodec = config.vcodec || 'libx264';
        config.packetSize = config.packetSize || 188;

        return config;
    }

    private generateVideoConfig(videoConfig, request, appleDevice = "") {
        let config = { ...videoConfig };

        config.vcodec = config.vcodec ??= 'libx264';
        config.acodec = config.acodec ??= 'libfdk_aac';
        config.encoderOptions = config.encoderOptions ??= '-preset ultrafast -tune zerolatency';
        config.packetSize = config.packetSize ??= 1128;
        config.forceMax = config.forceMax ??= false;

        switch (appleDevice) {

            /**
             * req:{"sessionID":"xxx","type":"start","video":{"codec":0,"profile":2,"level":2,"packetizationMode":0,"width":1280,"height":720,"fps":30,"pt":99,"ssrc":1671847285,"max_bit_rate":299,"rtcp_interval":0.5,"mtu":1378},"audio":{"codec":"AAC-eld","channel":1,"bit_rate":0,"sample_rate":16,"packet_time":30,"pt":110,"ssrc":xxx,"max_bit_rate":24,"rtcp_interval":5,"comfort_pt":13,"comfortNoiseEnabled":false}}
             */

            case "iPhone":
                config.maxWidth = config.maxWidth || 1280;
                config.maxHeight = config.maxHeight || 720;
                config.maxFPS = config.maxFPS >= 24 ? videoConfig.maxFPS : 30;
                config.maxStreams = config.maxStreams >= 2 ? videoConfig.maxStreams : 2;
                config.maxBitrate = config.maxBitrate || 299;
                break;

            /**
             * {"sessionID":"xxx","type":"start","video":{"codec":0,"profile":2,"level":2,"packetizationMode":0,"width":1920,"height":1080,"fps":30,"pt":99,"ssrc":1643739993,"max_bit_rate":802,"rtcp_interval":0.5,"mtu":1378},"audio":{"codec":"AAC-eld","channel":1,"bit_rate":0,"sample_rate":16,"packet_time":30,"pt":110,"ssrc":xxx,"max_bit_rate":24,"rtcp_interval":5,"comfort_pt":13,"comfortNoiseEnabled":false}}
             */

            case "iPad":
                config.maxWidth = config.maxWidth || 1920;
                config.maxHeight = config.maxHeight || 1080;
                config.maxFPS = config.maxFPS >= 24 ? videoConfig.maxFPS : 30;
                config.maxStreams = config.maxStreams >= 2 ? videoConfig.maxStreams : 2;
                config.maxBitrate = config.maxBitrate || 802;
                break;

            /**
             * req:{"sessionID":"xxx","type":"start","video":{"codec":0,"profile":2,"level":2,"packetizationMode":0,"width":320,"height":240,"fps":15,"pt":99,"ssrc":947616013,"max_bit_rate":68,"rtcp_interval":0.5,"mtu":1378},"audio":{"codec":"AAC-eld","channel":1,"bit_rate":0,"sample_rate":16,"packet_time":60,"pt":110,"ssrc":xxx,"max_bit_rate":24,"rtcp_interval":5,"comfort_pt":13,"comfortNoiseEnabled":false}}
             */

            case "AppleWatch":
                config.maxWidth = config.maxWidth || 1920;
                config.maxHeight = config.maxHeight || 1080;
                config.maxFPS = config.maxFPS >= 24 ? videoConfig.maxFPS : 30;
                config.maxStreams = config.maxStreams >= 2 ? videoConfig.maxStreams : 2;
                config.maxBitrate = config.maxBitrate || 802;
                break;

            /**
             * req:{"sessionID":"xxx","type":"start","video":{"codec":0,"profile":2,"level":2,"packetizationMode":0,"width":1280,"height":720,"fps":30,"pt":99,"ssrc":2211981671,"max_bit_rate":299,"rtcp_interval":0.5,"mtu":1378},"audio":{"codec":"AAC-eld","channel":1,"bit_rate":0,"sample_rate":16,"packet_time":30,"pt":110,"ssrc":xxx,"max_bit_rate":24,"rtcp_interval":5,"comfort_pt":13,"comfortNoiseEnabled":false}}
             */

            case "Mac":
                config.maxWidth = config.maxWidth || 1280;
                config.maxHeight = config.maxHeight || 720;
                config.maxFPS = config.maxFPS >= 24 ? videoConfig.maxFPS : 30;
                config.maxStreams = config.maxStreams >= 2 ? videoConfig.maxStreams : 2;
                config.maxBitrate = config.maxBitrate || 299;
                break;

            /**
             * req:{"sessionID":"xxx","type":"start","video":{"codec":0,"profile":2,"level":2,"packetizationMode":0,"width":1920,"height":1080,"fps":30,"pt":99,"ssrc":2685104393,"max_bit_rate":802,"rtcp_interval":0.5,"mtu":1378},"audio":{"codec":"AAC-eld","channel":1,"bit_rate":0,"sample_rate":16,"packet_time":30,"pt":110,"ssrc":xxx,"max_bit_rate":24,"rtcp_interval":5,"comfort_pt":13,"comfortNoiseEnabled":false}}
             */

            case "AppleTV":
                config.maxWidth = config.maxWidth || 1920;
                config.maxHeight = config.maxHeight || 1080;
                config.maxFPS = config.maxFPS >= 24 ? videoConfig.maxFPS : 30;
                config.maxStreams = config.maxStreams >= 2 ? videoConfig.maxStreams : 2;
                config.maxBitrate = config.maxBitrate || 802;
                break;

            default:
        }

        return config;
    }

    private generateInputSource(videoConfig, source) {
        let inputSource = source || videoConfig.source;

        if (inputSource) {
            if (videoConfig.readRate && !inputSource.includes('-re')) {
                inputSource = `-re ${inputSource}`;
            }

            if (videoConfig.reconnect > 1 && !inputSource.includes("-reconnect")) {
                inputSource = `-reconnect ${videoConfig.reconnect * 1} ${inputSource}`;
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

    private is_rtsp_ready(): boolean {

        this.platform.log.debug(this.cameraName, 'RTSP rtspStream:' + JSON.stringify(this.device.hasProperty('rtspStream')));
        if (!this.device.hasProperty('rtspStream')) {
            this.platform.log.debug(this.cameraName, 'Looks like not compatible with RTSP');
            return false;
        }

        this.platform.log.debug(this.cameraName, 'RTSP cameraConfig: ' + JSON.stringify(this.cameraConfig.rtsp));
        if (!this.cameraConfig.rtsp) {
            this.platform.log.debug(this.cameraName, 'Looks like RTSP is not enabled on camera config');
            return false;
        }

        this.platform.log.debug(this.cameraName, 'RTSP ' + JSON.stringify(this.device.getPropertyValue(PropertyName.DeviceRTSPStream)));
        if (!this.device.getPropertyValue(PropertyName.DeviceRTSPStream)) {
            this.platform.log.debug(this.cameraName, ': RTSP capabilities not enabled. You will need to do it manually!');
            return false;
        }

        this.platform.log.debug(this.cameraName, 'RTSP ' + JSON.stringify(this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl)));
        if (this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) === '') {
            this.platform.log.debug(this.cameraName, ': RTSP URL is unknow');
            return false;
        }

        return true;
    }

    private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {

        const sessionInfo = this.pendingSessions.get(request.sessionID);

        if (sessionInfo) {
            let inputChanged = false;
            let prebufferInput = true;
            let uVideoStream;
            let uAudioStream;
            let ffmpegInput;
            let cachedStreamId: number | null = null;

            const rtsp = this.is_rtsp_ready();

            if (false) {
                ffmpegInput = ['-re', '-loop', '1', '-i', offlineImage];
                inputChanged = true;
            } else if (false) {
                ffmpegInput = ['-re', '-loop', '1', '-i', privacyImage];
                inputChanged = true;
            } else if (rtsp) {
                const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
                this.platform.log.debug(this.cameraName, 'RTSP URL: ' + url);
                this.videoConfig.source = '-i ' + url;
                ffmpegInput = this.generateInputSource(this.videoConfig, this.videoConfig.source).split(/\s+/);
            } else {
                try {
                    const streamData = await this.localLivestreamCache.getLocalLivestream().catch(err => {
                        throw err;
                    });
                    cachedStreamId = streamData.id;
                    uVideoStream = StreamInput(streamData.videostream, this.cameraName + '_video', this.platform.eufyPath, this.log);
                    uAudioStream = StreamInput(streamData.audiostream, this.cameraName + '_audio', this.platform.eufyPath, this.log);
                    this.videoConfig.source = '-i ' + uVideoStream.url;
                    ffmpegInput = this.generateInputSource(this.videoConfig, this.videoConfig.source).split(/\s+/);
                } catch (err) {
                    this.log.error(this.cameraName + ' Unable to start the livestream: ' + err as string);
                }
            }

            this.videoConfig = this.generateVideoConfig(this.videoConfig, request.video);

            this.log.debug(this.cameraName, 'VIDEOCONFIG: ' + JSON.stringify(this.videoConfig));

            const resolution = this.determineResolution(request.video, false);

            let fps = this.videoConfig.maxFPS && this.videoConfig.forceMax ? this.videoConfig.maxFPS : request.video.fps;
            let videoBitrate = this.videoConfig.maxBitrate && this.videoConfig.forceMax ? this.videoConfig.maxBitrate : request.video.max_bit_rate;
            let bufsize = request.video.max_bit_rate * 2;
            let maxrate = request.video.max_bit_rate;
            let encoderOptions = this.videoConfig.encoderOptions;

            if (this.videoConfig.vcodec === 'copy') {
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
                this.videoConfig.vcodec === 'copy'
                    ? 'native'
                    : `${resolution.width}x${resolution.height}, ${fps} fps, ${videoBitrate} kbps ${this.videoConfig.audio ? ' (' + request.audio.codec + ')' : ''
                    }`;

            this.log.info(this.cameraName, `Starting video stream: ${resolutionText}`);

            let ffmpegVideoArgs = [
                '-hide_banner',
                '-loglevel',
                `level${this.videoConfig.debug ? '+verbose' : ''}`,
                '-use_wallclock_as_timestamps 1',
                ...ffmpegInput,
            ];

            if (!inputChanged && !prebufferInput && this.videoConfig.mapvideo) {
                ffmpegVideoArgs.push('-map', this.videoConfig.mapvideo);
            } else {
                ffmpegVideoArgs.push('-an', '-sn', '-dn');
            }

            if (fps) {
                ffmpegVideoArgs.push('-r', fps);
            }

            ffmpegVideoArgs.push(
                '-vcodec',
                inputChanged ? (this.videoConfig.vcodec === 'copy' ? 'libx264' : this.videoConfig.vcodec) : this.videoConfig.vcodec,
                '-pix_fmt',
                'yuv420p',
                '-color_range',
                'mpeg',
                '-f',
                'rawvideo'
            );

            if (encoderOptions) {
                ffmpegVideoArgs.push(...encoderOptions.split(/\s+/));
            }

            if (resolution.videoFilter) {
                ffmpegVideoArgs.push('-filter:v', ...resolution.videoFilter.split(/\s+/));
            }

            if (videoBitrate > 0) {
                ffmpegVideoArgs.push('-b:v', `${videoBitrate}k`);
            }

            if (bufsize > 0) {
                ffmpegVideoArgs.push('-bufsize', `${bufsize}k`);
            }

            if (maxrate > 0) {
                ffmpegVideoArgs.push('-maxrate', `${maxrate}k`);
            }

            ffmpegVideoArgs.push( // Video Stream
                '-payload_type ' + request.video.pt,
                '-ssrc ' + sessionInfo.videoSSRC,
                '-f rtp',
                '-srtp_out_suite AES_CM_128_HMAC_SHA1_80',
                '-srtp_out_params ' + sessionInfo.videoSRTP.toString('base64'),
                'srtp://' + sessionInfo.address + ':' + sessionInfo.videoPort +
                '?rtcpport=' + sessionInfo.videoPort + '&pkt_size=' + this.videoConfig.packetSize,
            );

            const ffmpegAudioArgs: Array<string> = [];

            const useAudio = (request.audio.codec === AudioStreamingCodecType.OPUS ||
                                request.audio.codec === AudioStreamingCodecType.AAC_ELD);

            if (useAudio) {

                if (!rtsp) {
                    ffmpegAudioArgs.push(`-i ${uAudioStream.url}`);
                } else {
                    ffmpegAudioArgs.push(...ffmpegInput);
                }

                ffmpegAudioArgs.push( // Audio
                    '-vn -sn -dn',
                    (request.audio.codec === AudioStreamingCodecType.OPUS ?
                        '-codec:a libopus' + ' -application lowdelay' :
                        '-codec:a libfdk_aac' + ' -profile:a aac_eld'),
                    '-flags +global_header',
                    '-ar ' + request.audio.sample_rate + 'k',
                    '-b:a ' + request.audio.max_bit_rate + 'k',
                    '-ac ' + request.audio.channel,
                    '-payload_type ' + request.audio.pt,
                );

                ffmpegAudioArgs.push( // Audio Stream
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

            ffmpegVideoArgs.push('-progress pipe:1');
            ffmpegAudioArgs.push('-progress pipe:1');

            const clean_ffmpegVideoArgs = ffmpegVideoArgs.filter(function (el) { return el; });
            const clean_ffmpegAudioArgs = ffmpegAudioArgs.filter(function (el) { return el; });

            const activeSession: ActiveSession = {};

            if (cachedStreamId !== null) {
                activeSession.cachedStreamId = cachedStreamId;
            }

            activeSession.socket = createSocket(sessionInfo.ipv6 ? 'udp6' : 'udp4');
            activeSession.socket.on('error', (err: Error) => {
                this.log.error(this.cameraName, 'Socket error: ' + err.message);
                this.stopStream(request.sessionID);
            });
            activeSession.socket.on('message', () => {
                if (activeSession.timeout) {
                    clearTimeout(activeSession.timeout);
                }
                activeSession.timeout = setTimeout(() => {
                    this.log.debug(this.cameraName, 'Device appears to be inactive. Stopping video stream.');
                    this.controller.forceStopStreamingSession(request.sessionID);
                    this.stopStream(request.sessionID);
                }, request.video.rtcp_interval * 5 * 1000);
            });
            activeSession.socket.bind(sessionInfo.videoReturnPort);

            activeSession.uVideoStream = uVideoStream;
            activeSession.uAudioStream = uAudioStream;

            activeSession.videoProcess = new FfmpegProcess(this.cameraName, request.sessionID, this.videoProcessor,
                clean_ffmpegVideoArgs, this.log, this.videoConfig.debug, this, callback);
            
            if (useAudio) {
                activeSession.audioProcess = new FfmpegProcess(this.cameraName, request.sessionID, this.videoProcessor,
                    clean_ffmpegAudioArgs, this.log, this.videoConfig.debug, this);
            }

            if (!this.cameraConfig.rtsp) {
                // streamData.station.on('livestream stop', (station: Station, channel: number) => {
                //     if (this.platform.eufyClient.getStationDevice(station.getSerial(), channel).getSerial() === this.device.getSerial()) {
                //         this.log.info(this.cameraName, 'Eufy Station stopped the stream. Stopping stream.');
                //         this.controller.forceStopStreamingSession(request.sessionID);
                //         this.stopStream(request.sessionID);
                //     }
                // });
            }

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
                session.videoProcess?.stop();
            } catch (err) {
                this.log.error(this.cameraName, 'Error occurred terminating video FFmpeg process: ' + err);
            }
            try {
                session.audioProcess?.stop();
            } catch (err) {
                this.log.error(this.cameraName, 'Error occurred terminating audio FFmpeg process: ' + err);
            }
            try {
                session.socket?.close();
            } catch (err) {
                this.log.error(this.cameraName, 'Error occurred closing socket: ' + err);
            }
            try {
                if (!this.cameraConfig.rtsp) {
                    session.uVideoStream?.close();
                    session.uAudioStream?.close();
                }
            } catch (err) {
                this.log.error(this.cameraName, 'Error occurred Universal Stream: ' + err);
            }
            try {
                if (!this.cameraConfig.rtsp && session.cachedStreamId) {
                    this.localLivestreamCache.stopCachedStream(session.cachedStreamId);
                }
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
