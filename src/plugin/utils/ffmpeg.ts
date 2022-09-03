import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import net from 'net';
import os from 'os';
import { Readable, Writable } from 'stream';

import ffmpegPath from 'ffmpeg-for-homebridge';
import pickPort from 'pick-port';

import { Logger } from './logger';
import EventEmitter from 'events';
import { CameraConfig } from './configTypes';
import { AudioStreamingCodecType, ReconfigureStreamRequest, SnapshotRequest, StartStreamRequest } from 'homebridge';
import { SessionInfo } from '../controller/streamingDelegate';

class FFmpegProgress extends EventEmitter {
  private port: number;
  private server: net.Server;
  private started = false;

  constructor(port: number) {
    super();
    this.port = port;
    let killTimeout: NodeJS.Timeout | undefined = undefined;
    this.server = net.createServer((socket) => {
      if (killTimeout) {
        clearTimeout(killTimeout);
      }
      this.server.close(); // close server and terminate after connection is released

      socket.on('data', this.analyzeProgress.bind(this));

      socket.on('error', (err) => {
        // ignore since this is handled elsewhere
      });
    });

    killTimeout = setTimeout(() => {
      this.server.close();
    }, 30 * 1000);

    this.server.on('close', () => {
      this.emit('progress stopped');
    });

    this.server.on('error', (err) => {
      // ignore since this is handled elsewhere
    });

    this.server.listen(this.port);
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
  private hideBanner = true;
  private useWallclockAsTimestamp = true;

  private inputSoure = '-i pipe:';
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

  // audio options
  private sampleRate?: number;
  private channels?: number;
  private flagsGlobalHeader = false;

  // snapshot options
  private numberFrames?: number;
  private delaySnapshot = false;

  private constructor(port: number, isVideo: boolean, isAudio: boolean, isSnapshot: boolean, debug = false) {
    this.progressPort = port;
    this.isVideo = isVideo;
    this.isAudio = isAudio;
    this.isSnapshot = isSnapshot;
    this.debug = debug;
  }

  static async forAudio(debug = false): Promise<FFmpegParameters> {
    const port = await pickPort({
      type: 'tcp',
      ip: '0.0.0.0',
      reserveTimeout: 15,
    });
    const ffmpeg = new FFmpegParameters(port, false, true, false, debug);
    ffmpeg.useWallclockAsTimestamp = false;
    ffmpeg.flagsGlobalHeader = true;
    return ffmpeg;
  }

  static async forVideo(debug = false): Promise<FFmpegParameters> {
    const port = await pickPort({
      type: 'tcp',
      ip: '0.0.0.0',
      reserveTimeout: 15,
    });
    return new FFmpegParameters(port, true, false, false, debug);
  }

  static async forSnapshot(debug = false): Promise<FFmpegParameters> {
    const port = await pickPort({
      type: 'tcp',
      ip: '0.0.0.0',
      reserveTimeout: 15,
    });
    const ffmpeg = new FFmpegParameters(port, false, false, true, debug);
    ffmpeg.useWallclockAsTimestamp = false;
    ffmpeg.numberFrames = 1;
    ffmpeg.format = 'image2';
    return ffmpeg;
  }

  public setResolution(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  public usesStdInAsInput(): boolean {
    return this.inputSoure === '-i pipe:';
  }

  public setInputSource(value: string) {
    // TODO: check for errors
    this.inputSoure = `-i ${value}`;
  }

  public async setInputStream(input: Readable) {
    const port = await pickPort({
      type: 'tcp',
      ip: '0.0.0.0',
      reserveTimeout: 15,
    });
    let killTimeout: NodeJS.Timeout | undefined = undefined;
    const server = net.createServer((socket) => {
      if (killTimeout) {
        clearTimeout(killTimeout);
      }
      server.close();

      socket.on('error', (_) => {
        // ignore since this is handled elsewhere
      });

      input.pipe(socket);
    });
    server.listen(port);

    server.on('error', (_) => {
      // ignore since this is handled elsewhere
    });

    killTimeout = setTimeout(() => {
      server.close();
    }, 30 * 1000);

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
      let codec = 'libx264';
      if (videoConfig.vcodec && videoConfig.vcodec !== '') {
        codec = videoConfig.vcodec;
      }
      this.codec = codec;
      if (codec !== 'copy') {
        const fps = videoConfig.maxFPS ? videoConfig.maxFPS : req.video.fps;
        this.fps = fps;
        const bitrate = videoConfig.maxBitrate ? videoConfig.maxBitrate : req.video.max_bit_rate;
        this.bitrate = bitrate;
        this.bufsize = bitrate * 2;
        this.maxrate = bitrate;
        let encoderOptions = codec === 'libx264' ? '-preset ultrafast -tune zerolatency' : '';
        if (videoConfig.encoderOptions && videoConfig.encoderOptions !== '') {
          encoderOptions = videoConfig.encoderOptions;
        }
        this.codecOptions = encoderOptions;
        this.pixFormat = 'yuv420p';
        this.colorRange = 'mpeg';
        let width = req.video.width;
        if (videoConfig.maxWidth && videoConfig.maxWidth < width) {
          width = videoConfig.maxWidth;
        }
        let height = req.video.height;
        if (videoConfig.maxHeight && videoConfig.maxHeight < height) {
          height = videoConfig.maxHeight;
        }
        this.width = width;
        this.height = height;
        if (videoConfig.videoFilter && videoConfig.videoFilter !== '') {
          this.filters = videoConfig.videoFilter;
        }
      }
    }
    if (this.isAudio) {
      const req = request as StartStreamRequest;
      let codec = req.audio.codec === AudioStreamingCodecType.OPUS ? 'libopus' : 'libfdk_aac';
      let codecOptions = req.audio.codec === AudioStreamingCodecType.OPUS ? '-application lowdelay' : '-profile:a aac_eld';
      if (videoConfig.acodec && videoConfig.acodec !== '') {
        codec = videoConfig.acodec;
        codecOptions = '';
      }
      if (this.flagsGlobalHeader) {
        if (codecOptions !== '') {
          codecOptions += ' ';
        }
        codecOptions += '-flags +global_header';
      }
      this.codec = codec;
      this.codecOptions = codecOptions;
      let samplerate = req.audio.sample_rate;
      if (videoConfig.audioSampleRate &&
        (videoConfig.audioSampleRate === 8 || videoConfig.audioSampleRate === 16 || videoConfig.audioSampleRate === 24)) {
        samplerate = videoConfig.audioSampleRate;
      }
      if (this.codec !== ' copy') {
        this.sampleRate = samplerate;
        this.channels = req.audio.channel;
        this.bitrate = req.audio.max_bit_rate;
      }
    }
    if (this.isSnapshot) {
      const req = request as SnapshotRequest;
      let width = req.width;
      if (videoConfig.maxWidth && videoConfig.maxWidth < width) {
        width = videoConfig.maxWidth;
      }
      let height = req.height;
      if (videoConfig.maxHeight && videoConfig.maxHeight < height) {
        height = videoConfig.maxHeight;
      }
      this.width = width;
      this.height = height;
      if (videoConfig.videoFilter && videoConfig.videoFilter !== '') {
        this.filters = videoConfig.videoFilter;
      }
    }
  }

  public setRTPTarget(sessionInfo: SessionInfo, request: StartStreamRequest) {

    if (this.isVideo) {
      this.payloadType = request.video.pt;
      this.ssrc = sessionInfo.videoSSRC;
      this.srtpParams = sessionInfo.videoSRTP.toString('base64');
      this.srtpSuite = 'AES_CM_128_HMAC_SHA1_80';
      this.format = 'rtp';
      this.output = `srtp://${sessionInfo.address}:${sessionInfo.videoPort}?rtcpport=${sessionInfo.videoPort}&pkt_size=1128`;
    }
    if (this.isAudio) {
      this.payloadType = request.audio.pt;
      this.ssrc = sessionInfo.audioSSRC;
      this.srtpParams = sessionInfo.audioSRTP.toString('base64');
      this.srtpSuite = 'AES_CM_128_HMAC_SHA1_80';
      this.format = 'rtp';
      this.output = `srtp://${sessionInfo.address}:${sessionInfo.audioPort}?rtcpport=${sessionInfo.audioPort}&pkt_size=188`;
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

    const port = await pickPort({
      type: 'tcp',
      ip: '0.0.0.0',
      reserveTimeout: 15,
    });
    let killTimeout: NodeJS.Timeout | undefined = undefined;
    const server = net.createServer((socket) => {
      if (killTimeout) {
        clearTimeout(killTimeout);
      }
      server.close();

      socket.on('error', (_) => {
        // ignore since this is handled elsewhere
      });

      socket.end(sdpInput);
    });
    server.listen(port);

    server.on('error', (_) => {
      // ignore since this is handled elsewhere
    });

    killTimeout = setTimeout(() => {
      server.close();
    }, 30 * 1000);
    this.setInputSource(`tcp://127.0.0.1:${port}`);
  }

  private buildGenericParameters(): string[] {
    const params: string[] = [];

    params.push(this.hideBanner ? '-hide_banner' : '');
    params.push('-loglevel level+verbose'); // default log to stderr
    params.push(this.useWallclockAsTimestamp ? '-use_wallclock_as_timestamps 1' : '');

    return params;
  }

  private buildInputParamters(): string[] {
    const params: string[] = [];
    
    // input
    params.push(this.analyzeDuration ? `-analyzeduration ${this.analyzeDuration}`: '');
    params.push(this.probeSize ? `-probesize ${this.probeSize}`: '');
    params.push(this.stimeout ? `-stimeout ${this.stimeout * 10000000}`: '');
    params.push(this.readrate ? '-re' : '');

    params.push(this.protocolWhitelist ? `-protocol_whitelist ${this.protocolWhitelist}` : '');
    params.push(this.inputFormat ? `-f ${this.inputFormat}`: '');
    params.push(this.inputCodec ? `-c:a ${this.inputCodec}`: '');
    params.push(this.inputSoure);
    params.push(this.isVideo ? '-an -sn -dn' : '');
    params.push(this.isAudio ? '-vn -sn -dn' : '');
    return params;
  }

  private buildEncodingParameters(): string[] {
    const params: string[] = [];
    if (this.isVideo) {
      params.push(this.fps ? '-r ' + this.fps : '');
      params.push('-vcodec ' + this.codec);
      params.push(this.pixFormat ? '-pix_fmt ' + this.pixFormat : '');
      params.push(this.colorRange ? '-color_range ' + this.colorRange : '');
      params.push(this.codecOptions ? this.codecOptions : '');

      // video filters
      const filters: string[] = this.filters ? this.filters.split(',') : [];
      const noneFilter = filters.indexOf('none');
      if (noneFilter >= 0) {
        filters.splice(noneFilter, 1);
      }
      if (noneFilter < 0 && this.width && this.height) {
        const resizeFilter = 'scale=' +
        '\'min(' + this.width + ',iw)\'' +
        ':' +
        '\'min(' + this.height + ',ih)\'' +
        ':force_original_aspect_ratio=decrease';
        filters.push(resizeFilter);
        filters.push('scale=\'trunc(iw/2)*2:trunc(ih/2)*2\''); // Force to fit encoder restrictions
      }
      if (filters.length > 0) {
        params.push('-filter:v ' + filters.join(','));
      }

      params.push(this.bitrate ? '-b:v ' + this.bitrate + 'k' : '');
      params.push(this.bufsize ? '-bufsize ' + this.bufsize + 'k' : '');
      params.push(this.maxrate ? `-maxrate ${this.maxrate}k` : '');
    }
    
    if (this.isAudio) {
      // audio parameters
      params.push('-acodec ' + this.codec);
      params.push(this.codecOptions ? this.codecOptions : '');
      params.push(this.bitrate ? `-b:a ${this.bitrate}k` : '');
      params.push(this.sampleRate ? `-ar ${this.sampleRate}k` : '');
      params.push(this.bitrate ? `-ac ${this.channels}` : '');
    }

    if (this.isSnapshot) {
      params.push(this.numberFrames ? `-frames:v ${this.numberFrames}` : '');
      params.push(this.delaySnapshot ? '-ss 00:00:00.500' : '');
      const filters: string[] = this.filters ? this.filters.split(',') : [];
      const noneFilter = filters.indexOf('none');
      if (noneFilter >= 0) {
        filters.splice(noneFilter, 1);
      }
      if (noneFilter < 0 && this.width && this.height) {
        const resizeFilter = 'scale=' +
        '\'min(' + this.width + ',iw)\'' +
        ':' +
        '\'min(' + this.height + ',ih)\'' +
        ':force_original_aspect_ratio=decrease';
        filters.push(resizeFilter);
        filters.push('scale=\'trunc(iw/2)*2:trunc(ih/2)*2\''); // Force to fit encoder restrictions
      }
      if (filters.length > 0) {
        params.push('-filter:v ' + filters.join(','));
      }
    }
    return params;
  }

  private buildOutputParameters(): string[] {
    const params: string[] = [];
    // output
    params.push(this.payloadType ? `-payload_type ${this.payloadType}` : '');
    params.push(this.ssrc ? `-ssrc ${this.ssrc}` : '');
    params.push(this.format ? `-f ${this.format}` : '');
    params.push(this.srtpSuite ? `-srtp_out_suite ${this.srtpSuite}` : '');
    params.push(this.srtpParams ? `-srtp_out_params ${this.srtpParams}` : '');

    params.push(this.output);
    return params;
  }

  private buildParameters(): string[] {
    let params: string[] = [];

    params = this.buildGenericParameters();
    params = params.concat(this.buildInputParamters());
    params = params.concat(this.buildEncodingParameters());
    params = params.concat(this.buildOutputParameters());

    params.push(`-progress tcp://127.0.0.1:${this.progressPort}`);

    params = params.filter(x => x !== '');

    return params;
  }

  public getProcessArguments(): string[] {
    return this.buildParameters();
  }

  static getCombinedArguments(parameters: FFmpegParameters[]): string[] {
    let params: string[] = [];
    if (parameters.length === 0) {
      return params;
    }

    params = parameters[0].buildGenericParameters();
    parameters.forEach((p) => {
      params = params.concat(p.buildInputParamters());
      params = params.concat(p.buildEncodingParameters());
      params = params.concat(p.buildOutputParameters());
    });
    params.push(`-progress tcp://127.0.0.1:${parameters[0].progressPort}`);
    params = params.filter(x => x !== '');

    return params;
  }

  public getStreamStartText(): string {
    let message = '';
    if (this.isVideo) {
      message = this.codec === 'copy' ? 'native' : `${this.width}x${this.height}, ${this.fps} fps, ${this.bitrate} kbps`;
      return `Starting video stream: ${message}`;
    }
    if (this.isAudio) {
      message = this.codec === 'copy' ? 'native' : `${this.sampleRate} kHz, ${this.bitrate} kbps, codec: ${this.codec}`;
      return `Starting audio stream: ${message}`;
    }
    return 'Starting unknown stream';
  }
}

export class FFmpeg extends EventEmitter {

  private process?: ChildProcessWithoutNullStreams;

  private name: string;
  private log: Logger;
  private progress?: FFmpegProgress;
  private parameters: FFmpegParameters[];

  private ffmpegExec = ffmpegPath || 'ffmpeg';

  public stdin?: Writable;
  public stdout?: Readable;

  private starttime?: number;
  private killTimeout?: NodeJS.Timeout;
  
  constructor(name: string, parameters: FFmpegParameters | FFmpegParameters[], log: Logger) {
    super();
    this.name = name;
    this.log = log;
    if (Array.isArray(parameters)) {
      if (parameters.length === 0) {
        throw new Error('No ffmpeg parameters found.');
      }
      this.parameters = parameters;
    } else {
      this.parameters = [parameters];
    }
  }

  public start() {

    this.starttime = Date.now();

    this.progress = new FFmpegProgress(this.parameters[0].progressPort);
    this.progress.on('progress started', this.onProgressStarted.bind(this));

    const processArgs = FFmpegParameters.getCombinedArguments(this.parameters);

    this.log.debug(this.name, 'Stream command: ' + this.ffmpegExec + ' ' + processArgs.join(' '));
    this.parameters.forEach((p) => {
      this.log.info(this.name, p.getStreamStartText());
    });

    this.process = spawn(this.ffmpegExec, processArgs.join(' ').split(/\s+/), { env: process.env });
    this.stdin = this.process.stdin;
    this.stdout = this.process.stdout;

    this.process.stderr.on('data', (chunk) => {
      if (this.parameters[0].debug) {
        this.log.debug(this.name, 'ffmpeg log message:\n' + chunk.toString());
      }
    });

    this.process.on('error', this.onProcessError.bind(this));
    this.process.on('exit', this.onProcessExit.bind(this));
  }

  public async getResult(input?: Buffer): Promise<Buffer> {
    this.starttime = Date.now();

    this.progress = new FFmpegProgress(this.parameters[0].progressPort);
    this.progress.on('progress started', this.onProgressStarted.bind(this));

    const processArgs = FFmpegParameters.getCombinedArguments(this.parameters);
    this.log.debug(this.name, 'Process command: ' + this.ffmpegExec + ' ' + processArgs.join(' '));

    return new Promise((resolve, reject) => {
      this.process = spawn(this.ffmpegExec, processArgs.join(' ').split(/\s+/), { env: process.env });

      this.process.stderr.on('data', (chunk) => {
        if (this.parameters[0].debug) {
          this.log.debug(this.name, 'ffmpeg log message:\n' + chunk.toString());
        }
      });

      const killTimeout = setTimeout(() => {
        this.stop();
        reject('ffmpeg process timed out.');
      }, 15 * 1000);
    
      this.process.on('error', (err) => {
        reject(err);
        this.onProcessError(err);
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

  public stop(): void {
    let usesStdIn = false;
    this.parameters.forEach(p => {
      if (p.usesStdInAsInput()) {
        usesStdIn = true;
      }
    });

    if (usesStdIn) {
      this.process?.stdin.destroy();
      this.process?.kill('SIGTERM');
    } else {
      this.process?.stdin.write('q' + os.EOL);
    }
    
    this.killTimeout = setTimeout(() => {
      this.process?.kill('SIGKILL');
    }, 2 * 1000);
  }

  private onProgressStarted() {
    this.emit('started');
    const runtime = this.starttime ? (Date.now() - this.starttime) / 1000 : undefined;
    this.log.debug(this.name, `process started. Getting the first response took ${runtime} seconds.`);
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
      this.log.info(this.name, message + ' (Expected)');
    } else if (code === null || code === 255) {
      if (this.process?.killed) {
        this.log.info(this.name, message + ' (Forced)');
      } else {
        this.log.error(this.name, message + ' (Unexpected)');
      }
    } else {
      this.log.error(this.name, message + ' (Error)');
    }
  }
}