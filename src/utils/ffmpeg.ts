// Node built-ins
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import EventEmitter from 'events';
import net from 'net';
import os from 'os';
import { Readable, Writable } from 'stream';

// External packages
import ffmpegPath from 'ffmpeg-for-homebridge';
import {
    AudioRecordingCodecType,
    AudioRecordingSamplerate,
    AudioStreamingCodecType,
    CameraRecordingConfiguration,
    H264Level,
    H264Profile,
    ReconfigureStreamRequest,
    SnapshotRequest,
    StartStreamRequest,
} from 'homebridge';
import { pickPort } from 'pick-port';

// Internal modules
import { CameraConfig, SessionInfo, VideoConfig } from './configTypes.js';
import { ffmpegLogger } from './utils.js';

/** Timeout for one-shot TCP servers waiting for a connection (ms) */
const TCP_SERVER_TIMEOUT_MS = 30_000;
/** Timeout for ffmpeg getResult() before force-killing the process (ms) */
const PROCESS_RESULT_TIMEOUT_MS = 15_000;
/** Grace period after SIGTERM before sending SIGKILL (ms) */
const KILL_GRACE_PERIOD_MS = 2_000;

/** Returns true when the value is a non-empty string (guards `undefined | ''`). */
function isNonEmpty(value: string | undefined): value is string {
    return !!value && value !== '';
}

/** Map HomeKit audio samplerate enum values to kHz strings for ffmpeg `-ar`. */
const SAMPLERATE_MAP: ReadonlyMap<AudioRecordingSamplerate, string> = new Map([
    [AudioRecordingSamplerate.KHZ_8, '8'],
    [AudioRecordingSamplerate.KHZ_16, '16'],
    [AudioRecordingSamplerate.KHZ_24, '24'],
    [AudioRecordingSamplerate.KHZ_32, '32'],
    [AudioRecordingSamplerate.KHZ_44_1, '44.1'],
    [AudioRecordingSamplerate.KHZ_48, '48'],
]);

/**
 * Creates a TCP server that accepts exactly one connection, then auto-closes.
 * If no connection arrives within the timeout, the server closes anyway.
 * @returns The port the server is listening on.
 */
async function createOneShotTcpServer(
    onConnection: (socket: net.Socket) => void,
    existingPort?: number,
): Promise<{ port: number; server: net.Server }> {
    const port = existingPort ?? await pickPort({ type: 'tcp' });
    let killTimeout: NodeJS.Timeout | undefined;

    const server = net.createServer((socket) => {
        if (killTimeout) {
            clearTimeout(killTimeout);
        }
        server.close();
        socket.on('error', () => { }); // ignore — handled elsewhere
        onConnection(socket);
    });

    server.on('error', () => { }); // ignore — handled elsewhere

    killTimeout = setTimeout(() => {
        server.close();
    }, TCP_SERVER_TIMEOUT_MS);

    server.listen(port);
    return { port, server };
}

class FFmpegProgress extends EventEmitter {
    private started = false;

    private constructor() {
        super();
    }

    static async create(port: number): Promise<FFmpegProgress> {
        const instance = new FFmpegProgress();
        const { server } = await createOneShotTcpServer((socket) => {
            socket.on('data', instance.analyzeProgress.bind(instance));
        }, port);
        server.on('close', () => instance.emit('progress stopped'));
        return instance;
    }

    private analyzeProgress(progressData: Buffer) {
        const progress = new Map<string, string>();
        progressData.toString().split(/\r?\n/).forEach((line) => {
            const split = line.split('=', 2);
            if (split.length !== 2) {
                return;
            }
            progress.set(split[0], split[1]);
        });

        if (!this.started) {
            if (progress.get('progress') !== undefined) {
                this.started = true;
                this.emit('progress started');
            }
        }
    }
}

export class FFmpegParameters {

    public progressPort: number;
    public debug: boolean;

    // default parameters
    processor?: string;
    private hideBanner = true;
    private useWallclockAsTimestamp = true;

    private inputSource = '-i pipe:';
    private protocolWhitelist?: string;
    private inputCodec?: string;
    private inputFormat?: string;
    private output = 'pipe:1';

    public isVideo: boolean;
    public isAudio: boolean;
    public isSnapshot: boolean;

    // generic options
    private analyzeDuration?: number;
    private probeSize?: number;
    private stimeout?: number;
    private readrate?: boolean;
    private codec = 'copy';
    private codecOptions?: string;
    private bitrate?: number;

    // output options
    private payloadType?: number;
    private ssrc?: number;
    private srtpSuite?: string;
    private srtpParams?: string;
    private format?: string;

    // video options
    private fps?: number;
    private pixFormat?: string;
    private colorRange?: string;
    private filters?: string;
    private width?: number;
    private height?: number;
    private bufsize?: number;
    private maxrate?: number;
    private crop = false;

    // audio options
    private sampleRate?: number | string;
    private channels?: number;
    private flagsGlobalHeader = false;

    // snapshot options
    private numberFrames?: number;
    private delaySnapshot = false;

    // recording options / fragmented mp4
    private movflags?: string;
    private maxMuxingQueueSize?: number;
    private iFrameInterval?: number;
    private processAudio = true;

    private constructor(port: number, isVideo: boolean, isAudio: boolean, isSnapshot: boolean, debug = false) {
        this.progressPort = port;
        this.isVideo = isVideo;
        this.isAudio = isAudio;
        this.isSnapshot = isSnapshot;
        this.debug = debug;
    }

    /** Allocate a progress port and construct an instance. */
    private static async create(
        isVideo: boolean, isAudio: boolean, isSnapshot: boolean, debug: boolean,
    ): Promise<FFmpegParameters> {
        const port = await pickPort({ type: 'tcp' });
        return new FFmpegParameters(port, isVideo, isAudio, isSnapshot, debug);
    }

    static async forAudio(debug = false): Promise<FFmpegParameters> {
        const ffmpeg = await FFmpegParameters.create(false, true, false, debug);
        ffmpeg.useWallclockAsTimestamp = false;
        ffmpeg.flagsGlobalHeader = true;
        return ffmpeg;
    }

    static async forVideo(debug = false): Promise<FFmpegParameters> {
        return FFmpegParameters.create(true, false, false, debug);
    }

    static async forSnapshot(debug = false): Promise<FFmpegParameters> {
        const ffmpeg = await FFmpegParameters.create(false, false, true, debug);
        ffmpeg.useWallclockAsTimestamp = false;
        ffmpeg.numberFrames = 1;
        ffmpeg.format = 'image2';
        return ffmpeg;
    }

    static async forVideoRecording(debug = false): Promise<FFmpegParameters> {
        const ffmpeg = await FFmpegParameters.create(true, false, false, debug);
        ffmpeg.useWallclockAsTimestamp = true;
        return ffmpeg;
    }

    static async forAudioRecording(debug = false): Promise<FFmpegParameters> {
        return FFmpegParameters.create(false, true, false, debug);
    }

    public setResolution(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    public usesStdInAsInput(): boolean {
        return this.inputSource === '-i pipe:';
    }

    public setInputSource(value: string) {
        this.inputSource = `-i ${value}`;
    }

    public async setInputStream(input: Readable) {
        const { port } = await createOneShotTcpServer((socket) => {
            input.pipe(socket);
        });
        this.setInputSource(`tcp://127.0.0.1:${port}`);
    }

    public setDelayedSnapshot() {
        this.delaySnapshot = true;
    }

    public setup(
        cameraConfig: CameraConfig,
        request: StartStreamRequest | ReconfigureStreamRequest | SnapshotRequest | undefined,
    ) {

        const videoConfig = cameraConfig.videoConfig ??= {};
        if (isNonEmpty(videoConfig.videoProcessor)) {
            this.processor = videoConfig.videoProcessor;
        }
        if (videoConfig.readRate) {
            this.readrate = videoConfig.readRate;
        }
        if (videoConfig.stimeout) {
            this.stimeout = videoConfig.stimeout;
        }
        if (videoConfig.probeSize) {
            this.probeSize = videoConfig.probeSize;
        }
        if (videoConfig.analyzeDuration) {
            this.analyzeDuration = videoConfig.analyzeDuration;
        }

        if (this.isVideo) {
            const req = request as StartStreamRequest | ReconfigureStreamRequest;
            this.codec = isNonEmpty(videoConfig.vcodec) ? videoConfig.vcodec : 'libx264';
            if (this.codec !== 'copy') {
                this.fps = videoConfig.maxFPS ?? req.video.fps;
                const bitrate = videoConfig.maxBitrate ?? req.video.max_bit_rate;
                this.bitrate = bitrate;
                this.bufsize = bitrate * 2;
                this.maxrate = bitrate;
                this.codecOptions = videoConfig.encoderOptions
                    ?? (this.codec === 'libx264' ? '-preset ultrafast -tune zerolatency' : '');
                this.pixFormat = 'yuv420p';
                this.colorRange = 'mpeg';
                this.applyVisualConfig(req.video.width, req.video.height, videoConfig);
            }
        }
        if (this.isAudio) {
            const req = request as StartStreamRequest;
            let codec = 'libfdk_aac';
            let codecOptions = '-profile:a aac_eld';
            switch (req.audio.codec) {
                case AudioStreamingCodecType.OPUS:
                    codec = 'libopus';
                    codecOptions = '-application lowdelay';
                    break;
                default:
                    codec = 'libfdk_aac';
                    codecOptions = '-profile:a aac_eld';
                    break;
            }

            if (isNonEmpty(videoConfig.acodec)) {
                codec = videoConfig.acodec;
                codecOptions = '';
            }
            if (videoConfig.acodecOptions !== undefined) {
                codecOptions = videoConfig.acodecOptions;
            }
            if (this.flagsGlobalHeader) {
                if (codecOptions !== '') {
                    codecOptions += ' ';
                }
                codecOptions += '-flags +global_header';
            }
            this.codec = codec;
            this.codecOptions = codecOptions;
            if (this.codec !== 'copy') {
                this.sampleRate = req.audio.sample_rate;
                this.channels = req.audio.channel;
                this.bitrate = videoConfig.audioBitrate ? videoConfig.audioBitrate : req.audio.max_bit_rate;
            }
        }
        if (this.isSnapshot) {
            const req = request as SnapshotRequest;
            this.applyVisualConfig(req.width, req.height, videoConfig);
        }
    }

    public setRTPTarget(sessionInfo: SessionInfo, request: StartStreamRequest) {
        const isVideo = this.isVideo;
        const mediaRequest = isVideo ? request.video : request.audio;
        const port = isVideo ? sessionInfo.videoPort : sessionInfo.audioPort;
        const pktSize = isVideo ? 1128 : 188;

        this.payloadType = mediaRequest.pt;
        this.ssrc = isVideo ? sessionInfo.videoSSRC : sessionInfo.audioSSRC;
        this.srtpParams = (isVideo ? sessionInfo.videoSRTP : sessionInfo.audioSRTP).toString('base64');
        this.srtpSuite = 'AES_CM_128_HMAC_SHA1_80';
        this.format = 'rtp';
        this.output = `srtp://${sessionInfo.address}:${port}?rtcpport=${port}&pkt_size=${pktSize}`;
    }

    public setOutput(output: string) {
        this.output = output;
    }

    public setupForRecording(videoConfig: VideoConfig, configuration: CameraRecordingConfiguration) {
        this.movflags = 'frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset';
        this.maxMuxingQueueSize = 1024;

        if (isNonEmpty(videoConfig.videoProcessor)) {
            this.processor = videoConfig.videoProcessor;
        }

        if (this.isVideo) {
            if (isNonEmpty(videoConfig.vcodec)) {
                this.codec = videoConfig.vcodec;
            } else {
                this.codec = 'libx264';
            }

            if (this.codec === 'libx264') {
                this.pixFormat = 'yuv420p';
                const profile =
                    configuration.videoCodec.parameters.profile === H264Profile.HIGH
                        ? 'high'
                        : configuration.videoCodec.parameters.profile === H264Profile.MAIN
                            ? 'main'
                            : 'baseline';
                const level =
                    configuration.videoCodec.parameters.level === H264Level.LEVEL4_0
                        ? '4.0'
                        : configuration.videoCodec.parameters.level === H264Level.LEVEL3_2
                            ? '3.2'
                            : '3.1';
                this.codecOptions = `-preset ultrafast -tune zerolatency -profile:v ${profile} -level:v ${level}`;
            }
            if (this.codec !== 'copy') {
                this.bitrate = videoConfig.maxBitrate ?? configuration.videoCodec.parameters.bitRate;
                this.width = configuration.videoCodec.resolution[0];
                this.height = configuration.videoCodec.resolution[1];
                this.fps = videoConfig.maxFPS ?? configuration.videoCodec.resolution[2];
                this.crop = (videoConfig.crop !== false); // only false if 'crop: false' was specifically set
            }

            this.iFrameInterval = configuration.videoCodec.parameters.iFrameInterval;
        }

        if (this.isAudio) {

            if (videoConfig.audio === false) {
                this.processAudio = false;
            }

            if (isNonEmpty(videoConfig.acodec)) {
                this.codec = videoConfig.acodec;
            } else {
                this.codec = 'libfdk_aac';
            }

            if (this.codec === 'libfdk_aac' || this.codec === 'aac') {
                this.codecOptions = (configuration.audioCodec.type === AudioRecordingCodecType.AAC_LC)
                    ? '-profile:a aac_low'
                    : '-profile:a aac_eld';
                this.codecOptions += ' -flags +global_header';
            }

            if (this.codec !== 'copy') {
                const samplerate = SAMPLERATE_MAP.get(configuration.audioCodec.samplerate);
                if (!samplerate) {
                    throw new Error(`Unsupported audio samplerate: ${configuration.audioCodec.samplerate}`);
                }
                this.sampleRate = samplerate;
                this.bitrate = configuration.audioCodec.bitrate;
                this.channels = configuration.audioCodec.audioChannels;
            }
        }
    }

    public async setTalkbackInput(sessionInfo: SessionInfo) {
        this.useWallclockAsTimestamp = false;
        this.protocolWhitelist = 'pipe,udp,rtp,file,crypto,tcp';
        this.inputFormat = 'sdp';
        this.inputCodec = 'libfdk_aac';
        this.codec = 'libfdk_aac';
        this.sampleRate = 16;
        this.channels = 1;
        this.bitrate = 20;
        this.format = 'adts';

        const ipVer = sessionInfo.ipv6 ? 'IP6' : 'IP4';
        const sdpInput =
            'v=0\r\n' +
            'o=- 0 0 IN ' + ipVer + ' ' + sessionInfo.address + '\r\n' +
            's=Talk\r\n' +
            'c=IN ' + ipVer + ' ' + sessionInfo.address + '\r\n' +
            't=0 0\r\n' +
            'm=audio ' + sessionInfo.audioReturnPort + ' RTP/AVP 110\r\n' +
            'b=AS:24\r\n' +
            'a=rtpmap:110 MPEG4-GENERIC/16000/1\r\n' +
            'a=rtcp-mux\r\n' + // FFmpeg ignores this, but might as well
            'a=fmtp:110 ' +
            'profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; ' +
            'config=F8F0212C00BC00\r\n' +
            'a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:' + sessionInfo.audioSRTP.toString('base64') + '\r\n';

        const { port } = await createOneShotTcpServer((socket) => {
            socket.end(sdpInput);
        });
        this.setInputSource(`tcp://127.0.0.1:${port}`);
    }

    public setTalkbackChannels(channels: number) {
        this.channels = channels;
    }

    private buildGenericParameters(): string[] {
        const params: string[] = [];

        if (this.hideBanner) params.push('-hide_banner');
        params.push('-loglevel level+verbose');
        if (this.useWallclockAsTimestamp) params.push('-use_wallclock_as_timestamps 1');

        return params;
    }

    private buildInputParameters(): string[] {
        const params: string[] = [];

        if (this.analyzeDuration) params.push(`-analyzeduration ${this.analyzeDuration}`);
        if (this.probeSize) params.push(`-probesize ${this.probeSize}`);
        if (this.stimeout) params.push(`-stimeout ${this.stimeout * 10000000}`);
        if (this.readrate) params.push('-re');
        if (this.protocolWhitelist) params.push(`-protocol_whitelist ${this.protocolWhitelist}`);
        if (this.inputFormat) params.push(`-f ${this.inputFormat}`);
        if (this.inputCodec) params.push(`-c:a ${this.inputCodec}`);
        params.push(this.inputSource);
        if (this.isVideo) params.push('-an -sn -dn');
        if (this.isAudio) params.push('-vn -sn -dn');

        return params;
    }

    /** Clamp a requested dimension to an optional max from the video config. */
    private static clampDimension(requested: number, max?: number): number {
        return (max && max < requested) ? max : requested;
    }

    /** Apply common visual settings (dimensions, filters, crop) from the video config. */
    private applyVisualConfig(width: number, height: number, videoConfig: VideoConfig) {
        this.width = FFmpegParameters.clampDimension(width, videoConfig.maxWidth);
        this.height = FFmpegParameters.clampDimension(height, videoConfig.maxHeight);
        if (isNonEmpty(videoConfig.videoFilter)) {
            this.filters = videoConfig.videoFilter;
        }
        if (videoConfig.crop) {
            this.crop = videoConfig.crop;
        }
    }

    /**
     * Builds scale/crop video filter arguments based on current width, height, crop settings,
     * and any user-specified filters. Shared between video and snapshot encoding.
     */
    private buildVideoFilterParams(): string[] {
        const filters: string[] = this.filters ? this.filters.split(',') : [];
        const noneFilter = filters.indexOf('none');
        if (noneFilter >= 0) {
            filters.splice(noneFilter, 1);
        }
        if (noneFilter < 0 && this.width && this.height) {
            if (this.crop) {
                filters.push(`scale=${this.width}:${this.height}:force_original_aspect_ratio=increase`);
                filters.push(`crop=${this.width}:${this.height}`);
                filters.push(`scale='trunc(${this.width}/2)*2:trunc(${this.height}/2)*2'`);
            } else {
                filters.push(
                    `scale='min(${this.width},iw)':'min(${this.height},ih)':force_original_aspect_ratio=decrease`,
                );
                filters.push('scale=\'trunc(iw/2)*2:trunc(ih/2)*2\'');
            }
        }
        if (filters.length > 0) {
            return ['-filter:v ' + filters.join(',')];
        }
        return [];
    }

    private buildEncodingParameters(): string[] {
        const params: string[] = [];
        if (this.isVideo) {
            if (this.fps) params.push(`-r ${this.fps}`);
            params.push(`-vcodec ${this.codec}`);
            if (this.pixFormat) params.push(`-pix_fmt ${this.pixFormat}`);
            if (this.colorRange) params.push(`-color_range ${this.colorRange}`);
            if (this.codecOptions) params.push(this.codecOptions);

            params.push(...this.buildVideoFilterParams());

            if (this.bitrate) params.push(`-b:v ${this.bitrate}k`);
            if (this.bufsize) params.push(`-bufsize ${this.bufsize}k`);
            if (this.maxrate) params.push(`-maxrate ${this.maxrate}k`);
        }

        if (this.isAudio && this.processAudio) {
            params.push(`-acodec ${this.codec}`);
            if (this.codecOptions) params.push(this.codecOptions);
            if (this.bitrate) params.push(`-b:a ${this.bitrate}k`);
            if (this.sampleRate) params.push(`-ar ${this.sampleRate}k`);
            if (this.channels) params.push(`-ac ${this.channels}`);
        }

        if (this.isSnapshot) {
            if (this.numberFrames) params.push(`-frames:v ${this.numberFrames}`);
            if (this.delaySnapshot) params.push('-ss 00:00:00.500');

            params.push(...this.buildVideoFilterParams());
        }
        return params;
    }

    private buildOutputParameters(): string[] {
        const params: string[] = [];
        if (this.payloadType) params.push(`-payload_type ${this.payloadType}`);
        if (this.ssrc) params.push(`-ssrc ${this.ssrc}`);
        if (this.format) params.push(`-f ${this.format}`);
        if (this.srtpSuite) params.push(`-srtp_out_suite ${this.srtpSuite}`);
        if (this.srtpParams) params.push(`-srtp_out_params ${this.srtpParams}`);
        params.push(this.output);
        return params;
    }

    private buildParameters(): string[] {
        const params = [
            ...this.buildGenericParameters(),
            ...this.buildInputParameters(),
            ...this.buildEncodingParameters(),
            ...this.buildOutputParameters(),
            `-progress tcp://127.0.0.1:${this.progressPort}`,
        ];
        return params;
    }

    public getProcessArguments(): string[] {
        return this.buildParameters();
    }

    static getRecordingArguments(parameters: FFmpegParameters[]): string[] {
        if (parameters.length === 0) {
            return [];
        }

        const params = [...parameters[0].buildGenericParameters()];

        // input
        params.push(parameters[0].inputSource);
        if (parameters.length > 1 && parameters[0].inputSource !== parameters[1].inputSource) {
            if (parameters[1].processAudio) {
                params.push(parameters[1].inputSource);
            } else {
                params.push('-f lavfi -i anullsrc -shortest');
            }
        }
        if (parameters.length === 1) {
            params.push('-an');
        }
        params.push('-sn -dn');

        // video encoding
        params.push(...parameters[0].buildEncodingParameters());
        if (parameters[0].iFrameInterval) {
            params.push(`-force_key_frames expr:gte(t,n_forced*${parameters[0].iFrameInterval / 1000})`);
        }

        // audio encoding
        if (parameters.length > 1) {
            if (parameters[1].processAudio) {
                params.push('-bsf:a aac_adtstoasc');
            }
            params.push(...parameters[1].buildEncodingParameters());
        }

        // fragmented mp4 options
        if (parameters[0].movflags) params.push(`-movflags ${parameters[0].movflags}`);
        if (parameters[0].maxMuxingQueueSize) params.push(`-max_muxing_queue_size ${parameters[0].maxMuxingQueueSize}`);

        // output
        params.push('-f mp4');
        params.push(parameters[0].output);
        params.push(`-progress tcp://127.0.0.1:${parameters[0].progressPort}`);

        return params;
    }

    static getCombinedArguments(parameters: FFmpegParameters[]): string[] {
        if (parameters.length === 0) {
            return [];
        }

        const params = [...parameters[0].buildGenericParameters()];
        for (const p of parameters) {
            params.push(...p.buildInputParameters());
            params.push(...p.buildEncodingParameters());
            params.push(...p.buildOutputParameters());
        }
        params.push(`-progress tcp://127.0.0.1:${parameters[0].progressPort}`);

        return params;
    }

    public getStreamStartText(): string {
        if (this.isVideo) {
            const detail = this.codec === 'copy' ? 'native' : `${this.width}x${this.height}, ${this.fps} fps, ${this.bitrate} kbps`;
            return `Starting video stream: ${detail}`;
        }
        if (this.isAudio) {
            const detail = this.codec === 'copy' ? 'native' : `${this.sampleRate} kHz, ${this.bitrate} kbps, codec: ${this.codec}`;
            return `Starting audio stream: ${detail}`;
        }
        return 'Starting unknown stream';
    }

    public hasCustomFfmpeg(): boolean {
        return this.processor !== undefined;
    }

    public getCustomFfmpeg(): string {
        return this.processor ?? '';
    }
}

export class FFmpeg extends EventEmitter {

    private process?: ChildProcessWithoutNullStreams;

    private name: string;
    private progress?: FFmpegProgress;
    private parameters: FFmpegParameters[];

    private ffmpegExec: string = (ffmpegPath as unknown as string) || 'ffmpeg';

    public stdin?: Writable;
    public stdout?: Readable;

    private starttime?: number;
    private killTimeout?: NodeJS.Timeout;

    constructor(name: string, parameters: FFmpegParameters | FFmpegParameters[]) {
        super();
        this.name = name;
        if (Array.isArray(parameters)) {
            if (parameters.length === 0) {
                throw new Error('No ffmpeg parameters found.');
            }
            this.parameters = parameters;
        } else {
            this.parameters = [parameters];
        }

        if (this.parameters[0].hasCustomFfmpeg()) {
            this.ffmpegExec = this.parameters[0].getCustomFfmpeg();
        }
    }

    public async start() {

        this.starttime = Date.now();

        this.progress = await FFmpegProgress.create(this.parameters[0].progressPort);
        this.progress.on('progress started', this.onProgressStarted.bind(this));

        const processArgs = FFmpegParameters.getCombinedArguments(this.parameters);

        ffmpegLogger.debug(this.name, 'Stream command: ' + this.ffmpegExec + ' ' + processArgs.join(' '));
        this.parameters.forEach((p) => {
            ffmpegLogger.info(this.name, p.getStreamStartText());
        });

        this.process = spawn(this.ffmpegExec, processArgs.join(' ').split(/\s+/), { env: process.env });
        this.stdin = this.process.stdin;
        this.stdout = this.process.stdout;

        this.process.stderr.on('data', this.handleStderrData.bind(this));

        this.process.on('error', this.onProcessError.bind(this));
        this.process.on('exit', this.onProcessExit.bind(this));
    }

    public async getResult(input?: Buffer): Promise<Buffer> {
        this.starttime = Date.now();

        this.progress = await FFmpegProgress.create(this.parameters[0].progressPort);
        this.progress.on('progress started', this.onProgressStarted.bind(this));

        const processArgs = FFmpegParameters.getCombinedArguments(this.parameters);
        ffmpegLogger.debug(this.name, 'Process command: ' + this.ffmpegExec + ' ' + processArgs.join(' '));

        return new Promise((resolve, reject) => {
            this.process = spawn(this.ffmpegExec, processArgs.join(' ').split(/\s+/), { env: process.env });

            this.process.stderr.on('data', this.handleStderrData.bind(this));

            const killTimeout = setTimeout(() => {
                this.stop();
                reject('ffmpeg process timed out.');
            }, PROCESS_RESULT_TIMEOUT_MS);

            this.process.on('error', (error) => {
                reject(error);
                this.onProcessError(error);
            });

            let resultBuffer = Buffer.alloc(0);
            this.process.stdout.on('data', (data) => {
                resultBuffer = Buffer.concat([resultBuffer, data]);
            });
            this.process.on('exit', () => {
                if (killTimeout) {
                    clearTimeout(killTimeout);
                }

                if (resultBuffer.length > 0) {
                    resolve(resultBuffer);
                } else {
                    reject('Failed to fetch data.');
                }
            });
            if (input) {
                this.process.stdin.end(input);
            }
        });
    }

    public async startFragmentedMP4Session(): Promise<{
        socket: net.Socket;
        process?: ChildProcessWithoutNullStreams;
        generator: AsyncGenerator<{
            header: Buffer;
            length: number;
            type: string;
            data: Buffer;
        }>;
    }> {
        this.starttime = Date.now();

        this.progress = await FFmpegProgress.create(this.parameters[0].progressPort);
        this.progress.on('progress started', this.onProgressStarted.bind(this));

        const port = await pickPort({ type: 'tcp' });

        return new Promise((resolve) => {
            const server = net.createServer((socket) => {
                server.close();

                resolve({
                    socket: socket,
                    process: this.process,
                    generator: this.parseFragmentedMP4(socket),
                });
            });

            server.listen(port, () => {
                this.parameters[0].setOutput(`tcp://127.0.0.1:${port}`);
                const processArgs = FFmpegParameters.getRecordingArguments(this.parameters);

                ffmpegLogger.debug(this.name, 'Stream command: ' + this.ffmpegExec + ' ' + processArgs.join(' '));
                this.parameters.forEach((p) => {
                    ffmpegLogger.info(this.name, p.getStreamStartText());
                });

                this.process = spawn(this.ffmpegExec, processArgs.join(' ').split(/\s+/), { env: process.env });
                this.stdin = this.process.stdin;
                this.stdout = this.process.stdout;

                this.process.stderr.on('data', this.handleStderrData.bind(this));

                this.process.on('error', this.onProcessError.bind(this));
                this.process.on('exit', this.onProcessExit.bind(this));
            });
        });
    }

    private async * parseFragmentedMP4(socket: net.Socket) {
        while (true) {
            const header = await this.readLength(socket, 8);
            const length = header.readInt32BE(0) - 8;
            const type = header.slice(4).toString();
            const data = await this.readLength(socket, length);

            yield {
                header,
                length,
                type,
                data,
            };
        }
    }

    private async readLength(socket: net.Socket, length: number): Promise<Buffer> {
        if (length <= 0) {
            return Buffer.alloc(0);
        }

        const value = socket.read(length);
        if (value) {
            return value;
        }

        return new Promise((resolve, reject) => {
            const readHandler = () => {
                const value = socket.read(length);

                if (value) {
                    cleanup();
                    resolve(value);
                }
            };

            const endHandler = () => {
                cleanup();
                reject(new Error(`FFMPEG socket closed during read for ${length} bytes!`));
            };

            const cleanup = () => {
                socket.removeListener('readable', readHandler);
                socket.removeListener('close', endHandler);
            };

            if (!socket) {
                throw new Error('FFMPEG socket is closed now!');
            }

            socket.on('readable', readHandler);
            socket.on('close', endHandler);
        });
    }

    public stop(): void {
        const usesStdIn = this.parameters.some(p => p.usesStdInAsInput());

        if (usesStdIn) {
            this.process?.stdin.destroy();
            this.process?.kill('SIGTERM');
        } else {
            this.process?.stdin.write('q' + os.EOL);
        }

        this.killTimeout = setTimeout(() => {
            this.process?.kill('SIGKILL');
        }, KILL_GRACE_PERIOD_MS);
    }

    private onProgressStarted() {
        this.emit('started');
        const runtime = this.starttime ? (Date.now() - this.starttime) / 1000 : undefined;
        ffmpegLogger.debug(this.name, `process started. Getting the first response took ${runtime} seconds.`);
    }

    private handleStderrData(chunk: Buffer) {
        const output = chunk.toString();
        const isError = output.includes('[panic]') || output.includes('[error]') || output.includes('[fatal]');

        if (isError) {
            ffmpegLogger.error(this.name, 'ffmpeg log message:\n' + output);
        } else if (this.parameters[0].debug) {
            ffmpegLogger.debug(this.name, 'ffmpeg log message:\n' + output);
        }
    }

    private onProcessError(error: Error) {
        this.emit('error', error);
    }

    private onProcessExit(code: number, signal: NodeJS.Signals) {
        this.emit('exit');

        if (this.killTimeout) {
            clearTimeout(this.killTimeout);
        }

        const message = 'FFmpeg exited with code: ' + code + ' and signal: ' + signal;
        if (this.killTimeout && code === 0) {
            ffmpegLogger.info(this.name, message + ' (Expected)');
        } else if (code === null || code === 255) {
            if (this.process?.killed) {
                ffmpegLogger.info(this.name, message + ' (Forced)');
            } else {
                ffmpegLogger.error(this.name, message + ' (Unexpected)');
            }
        } else {
            this.emit('error', message + ' (Error)');
            // ffmpegLogger.error(this.name, message + ' (Error)');
        }
    }
}