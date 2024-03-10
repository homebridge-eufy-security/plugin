import net from 'net';
import { Readable } from 'stream';

import { pickPort } from 'pick-port';

import { CameraConfig, VideoConfig } from './configTypes';
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
import { SessionInfo } from '../controller/streamingDelegate';

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

  // recording options / fragmented mp4
  private movflags?: string;
  private maxMuxingQueueSize?: number;
  private iFrameInterval?: number;

  private constructor(
    options: {
      port: number;
      isVideo: boolean;
      isAudio: boolean;
      isSnapshot: boolean;
      debug: boolean;
    },
  ) {
    this.progressPort = options.port;
    this.isVideo = options.isVideo;
    this.isAudio = options.isAudio;
    this.isSnapshot = options.isSnapshot;
    this.debug = options.debug;
  }

  private static async allocateddPort(type: string): Promise<number> {
    try {
      // Call pickPort function and await its result
      const port = await pickPort({
        type: type as "tcp" | "udp",
        ip: '0.0.0.0',
        reserveTimeout: 15,
      });

      return port; // Return the allocated port
    } catch (error) {
      // Handle any errors that might occur during port allocation
      console.error('Error allocating port:', error);
      throw error; // Rethrow the error to propagate it further if needed
    }
  }

  public static async allocateTCPPort(): Promise<number> {
    return FFmpegParameters.allocateddPort('tcp');
  }

  public static async allocateUDPPort(): Promise<number> {
    return FFmpegParameters.allocateddPort('udp');
  }

  static async create(
    options: {
      type: 'audio' | 'video' | 'snapshot' | 'videoRecording' | 'audioRecording';
      debug?: boolean;
    },
  ): Promise<FFmpegParameters> {
    const port = await FFmpegParameters.allocateTCPPort();
    const baseOptions = { port, isVideo: false, isAudio: false, isSnapshot: false, debug: options.debug ?? false };

    switch (options.type) {
      case 'audio': {
        const params = new FFmpegParameters({ ...baseOptions, isAudio: true });
        params.useWallclockAsTimestamp = false;

        // The '-flags +global_header' option is crucial for encoding streams, especially when using codecs like 'libfdk_aac'.
        // This flag ensures the inclusion of global headers in the output stream, which contain essential codec initialization data.
        // It's particularly important for streaming scenarios to ensure the receiving end can properly decode the stream from the start.
        // Omitting this flag can lead to errors in stream initialization and decoding failures in certain codecs and streaming contexts.

        params.flagsGlobalHeader = true;
        return params;
      }
      case 'video':
        return new FFmpegParameters({ ...baseOptions, isVideo: true });
      case 'snapshot': {
        const params = new FFmpegParameters({ ...baseOptions, isSnapshot: true });
        params.useWallclockAsTimestamp = true;
        params.numberFrames = 1;
        params.format = 'image2';
        return params;
      }
      case 'videoRecording': {
        const params = new FFmpegParameters({ ...baseOptions, isVideo: true });
        params.useWallclockAsTimestamp = true;
        return params;
      }
      case 'audioRecording':
        return new FFmpegParameters({ ...baseOptions, isAudio: true });
      default:
        throw new Error('Invalid FFmpegParameters type');
    }
  }

  public usesStdInAsInput(): boolean {
    return this.inputSoure === '-i pipe:';
  }

  public setInputSource(value: string) {
    // TODO: check for errors
    this.inputSoure = `-i ${value}`;
  }

  private async createServerWithTimeout(handleConnection: (socket: net.Socket) => void): Promise<number> {
    const port = await FFmpegParameters.allocateTCPPort();

    let killTimeout: NodeJS.Timeout | undefined = undefined;
    const server = net.createServer((socket) => {
      if (killTimeout) {
        clearTimeout(killTimeout);
      }
      server.close();
      socket.on('error', () => { /* handle error */ });
      handleConnection(socket);
    });

    server.listen(port);
    server.on('error', () => { /* handle error */ });

    killTimeout = setTimeout(() => server.close(), 30 * 1000);
    return port;
  }

  public async setInputStream(input: Readable) {
    const port = await this.createServerWithTimeout((socket) => {
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
        codecOptions += ' -flags +global_header';
      }
      this.codec = codec;
      this.codecOptions = codecOptions;
      let samplerate = req.audio.sample_rate;
      if (videoConfig.audioSampleRate &&
        (videoConfig.audioSampleRate === 8 || videoConfig.audioSampleRate === 16 || videoConfig.audioSampleRate === 24)) {
        samplerate = videoConfig.audioSampleRate;
      }
      this.sampleRate = samplerate;
      this.channels = req.audio.channel;
      this.bitrate = req.audio.max_bit_rate;
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

  public setOutput(output: string) {
    this.output = output;
  }

  public setupForRecording(videoConfig: VideoConfig, configuration: CameraRecordingConfiguration) {
    this.movflags = 'frag_keyframe+empty_moov+default_base_moof';
    this.maxMuxingQueueSize = 1024;

    if (this.isVideo) {

      if (videoConfig.vcodec && videoConfig.vcodec !== '') {
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
        this.codecOptions = `-profile:v ${profile} -level:v ${level}`;
      }
      if (this.codec !== 'copy') {
        this.bitrate = configuration.videoCodec.parameters.bitRate;
        this.width = configuration.videoCodec.resolution[0];
        this.height = configuration.videoCodec.resolution[1];
        this.fps = configuration.videoCodec.resolution[2];
      }

      this.iFrameInterval = configuration.videoCodec.parameters.iFrameInterval;
    }

    if (this.isAudio) {

      if (videoConfig.acodec && videoConfig.acodec !== '') {
        this.codec = videoConfig.acodec;
      } else {
        this.codec = 'libfdk_aac';
      }

      if (this.codec === 'libfdk_aac' || this.codec === 'aac') {
        this.codecOptions = (configuration.audioCodec.type === AudioRecordingCodecType.AAC_LC)
          ? '-profile:a aac_low'
          : '-profile:a aac_eld';
        // this.codecOptions += ' -flags +global_header';
      }

      if (this.codec !== 'copy') {
        let samplerate;

        switch (configuration.audioCodec.samplerate) {
          case AudioRecordingSamplerate.KHZ_8:
            samplerate = '8';
            break;
          case AudioRecordingSamplerate.KHZ_16:
            samplerate = '16';
            break;
          case AudioRecordingSamplerate.KHZ_24:
            samplerate = '24';
            break;
          case AudioRecordingSamplerate.KHZ_32:
            samplerate = '32';
            break;
          case AudioRecordingSamplerate.KHZ_44_1:
            samplerate = '44.1';
            break;
          case AudioRecordingSamplerate.KHZ_48:
            samplerate = '48';
            break;
          default:
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

    const port = await this.createServerWithTimeout((socket) => {
      socket.end(sdpInput);
    });
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
    params.push(this.analyzeDuration ? `-analyzeduration ${this.analyzeDuration}` : '');
    params.push(this.probeSize ? `-probesize ${this.probeSize}` : '');
    params.push(this.stimeout ? `-stimeout ${this.stimeout * 10000000}` : '');
    params.push(this.readrate ? '-re' : '');

    params.push(this.protocolWhitelist ? `-protocol_whitelist ${this.protocolWhitelist}` : '');
    params.push(this.inputFormat ? `-f ${this.inputFormat}` : '');
    params.push(this.inputCodec ? `-c:a ${this.inputCodec}` : '');

    params.push('-thread_queue_size 128');

    params.push(this.inputSoure);

    params.push(this.isVideo ? '-an -sn -dn' : '');
    params.push(this.isAudio ? '-vn -sn -dn' : '');
    return params;
  }

  private buildFilterParameters(): string[] {
    const filters: string[] = this.filters ? this.filters.split(',') : [];
    const noneFilter = filters.indexOf('none');
    if (noneFilter >= 0) {
      filters.splice(noneFilter, 1);
    }
    if (noneFilter < 0 && this.width && this.height) {
      const resizeFilter = 'scale=' +
        `'min(${this.width},iw)':` +
        `'min(${this.height},iw)':` +
        'force_original_aspect_ratio=decrease';
      filters.push(resizeFilter);
      filters.push('scale=\'trunc(iw/2)*2:trunc(ih/2)*2\''); // Force to fit encoder restrictions
      if (this.isSnapshot) {
        filters.push('fps=30');
      }
    }
    return filters.length > 0 ? ['-filter:v ' + filters.join(',')] : [];
  }

  private buildEncodingParameters(): string[] {
    const params: string[] = [];
    if (this.isVideo) {
      // params.push(this.fps ? '-r ' + this.fps : '');
      params.push('-vcodec ' + this.codec);
      params.push(this.pixFormat ? '-pix_fmt ' + this.pixFormat : '');
      params.push(this.colorRange ? '-color_range ' + this.colorRange : '');
      params.push(this.codecOptions ? this.codecOptions : '');

      params.concat(this.buildFilterParameters());

      params.push(this.bitrate ? '-b:v ' + this.bitrate + 'k' : '');
      params.push(this.bufsize ? '-bufsize ' + this.bufsize + 'k' : '');
      params.push(this.maxrate ? `-maxrate ${this.maxrate}k` : '');
    }

    if (this.isAudio) {
      // audio parameters
      params.push('-acodec ' + this.codec);
      // Adjust your FFmpeg command to handle AAC streams without global headers.
      // adding -bsf:a aac_adtstoasc as a bitstream filter for the audio stream, which converts ADTS to ASC (Audio Specific Config).
      params.push('-bsf:a aac_adtstoasc');
      params.push(this.codecOptions ? this.codecOptions : '');
      params.push(this.bitrate ? `-b:a ${this.bitrate}k` : '');
      params.push(this.sampleRate ? `-ar ${this.sampleRate}k` : '');
      params.push(this.bitrate ? `-ac ${this.channels}` : '');
    }

    if (this.isSnapshot) {
      params.push(this.numberFrames ? `-frames:v ${this.numberFrames}` : '');
      params.push(this.delaySnapshot ? '-ss 00:00:00.500' : '');
      params.concat(this.buildFilterParameters());
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

  static getRecordingArguments(parameters: FFmpegParameters[]): string[] {
    let params: string[] = [];
    if (parameters.length === 0) {
      return params;
    }

    params = parameters[0].buildGenericParameters();

    params.push('-nostats');
    params.push('-fflags', '+discardcorrupt+genpts');
    // params.push('-thread_queue_size 128');

    // params.push('-probesize 5000000');
    // params.push('-analyzeduration 5000000');
    // params.push('-max_delay 500000');



    // params.push('-r 15');

    // video input
    params.push('-thread_queue_size 128');
    params.push('-f h264');
    params.push(parameters[0].inputSoure);



    // params.push('-an -sn -dn');

    // audio input
    if (parameters.length > 1 && parameters[0].inputSoure !== parameters[1].inputSoure) { // don't include extra audio source for rtsp
      params.push('-thread_queue_size 128');
      params.push('-f aac');
      params.push(parameters[1].inputSoure);
      // params.push('-vn -sn -dn');

      // params.push('-bsf:a aac_adtstoasc');
    }

    params.push('-map 0:v');
    params.push('-vcodec copy');
    // params.push('-vsync 1');
    // params.push('-filter:v setpts=PTS-STARTPTS');

    params.push('-map 1:a');
    params.push('-acodec copy');
    // params.push('-rtpflags latm');
    params.push('-bsf:a aac_adtstoasc');
    // params.push('-filter:a asetpts=PTS-STARTPTS');

    // params.push(parameters[0].iFrameInterval ? `-force_key_frames expr:gte(t,n_forced*${parameters[0].iFrameInterval / 1000})` : '');
    params.push('-reset_timestamps', '1');

    // fragmented mp4 options
    params.push(parameters[0].movflags ? `-movflags ${parameters[0].movflags}` : '');
    // params.push(parameters[0].maxMuxingQueueSize ? `-max_muxing_queue_size ${parameters[0].maxMuxingQueueSize}` : '');

    // audio encoding
    if (parameters.length > 1) {
      // params = params.concat(parameters[1].buildEncodingParameters());
    }

    // output
    params.push('-f mp4');
    params.push(parameters[0].output);
    // params.push(`/tmp/${this.name}.mp4`);
    params.push(`-progress tcp://127.0.0.1:${parameters[0].progressPort}`);
    params = params.filter(x => x !== '');

    return params;
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