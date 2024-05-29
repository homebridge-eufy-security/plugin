import {
  APIEvent, AudioRecordingCodecType, AudioRecordingSamplerate,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraController,
  CameraControllerOptions, CameraRecordingConfiguration, CameraRecordingDelegate,
  CameraStreamingDelegate, H264Level, H264Profile,
  HDSProtocolSpecificErrorReason,
  MediaContainerType, PlatformAccessory,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse, RecordingPacket, SnapshotRequest,
  SnapshotRequestCallback,
  SRTPCryptoSuites,
  StartStreamRequest,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes, VideoInfo
} from 'homebridge';
import { VideoCodecType } from 'hap-nodejs';
import { createSocket, Socket } from 'dgram';
import { getStreamer, EufyStream, EufyStreamer } from './EufyStreamer';
import { EufySecurityPlatform } from '../platform';
import HksvStreamer from './HksvStreamer';
import { reservePorts } from '@homebridge/camera-utils';
import { CHAR, HAP } from '../utils/utils';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { DoorbellAccessory } from '../accessories/DoorbellAccessory';
import { FfmpegProcess } from '../utils/ffmpeg';
import { ILogObj, Logger } from 'tslog';
import { PROTECT_HKSV_SEGMENT_LENGTH, PROTECT_HKSV_TIMESHIFT_BUFFER_MAXLENGTH } from '../settings';
import { CommandName } from 'eufy-security-client';

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

type ActiveSession = {
  mainProcess?: FfmpegProcess;
  returnProcess?: FfmpegProcess;
  timeout?: NodeJS.Timeout;
  socket?: Socket;
  streamer: EufyStreamer;
};

type ResolutionInfo = {
  width: number;
  height: number;
  videoFilter: string;
};

type RecordingSessionInfo = {
  eufyStreamer: EufyStreamer,
  hksvStreamer: HksvStreamer
}

export abstract class StreamingDelegate<T extends CameraController> implements CameraStreamingDelegate, CameraRecordingDelegate {

  // keep track of sessions
  protected pendingSessions: Record<string, SessionInfo> = {};
  protected ongoingSessions: Record<string, ActiveSession> = {};
  protected options: CameraControllerOptions;
  protected controller!: T;

  // minimal secure video properties.
  protected cameraRecordingConfiguration?: CameraRecordingConfiguration;
  protected handlingRecordingStreamingRequest = false;
  protected recordingSessionInfo?: RecordingSessionInfo;

  protected log: Logger<ILogObj>;
  protected accessory: PlatformAccessory;
  protected platform: EufySecurityPlatform;

  constructor(
    protected camera: CameraAccessory | DoorbellAccessory,
  ) {

    this.log = camera.log;
    this.accessory = camera.accessory;
    this.platform = camera.platform;

    this.platform.api.on(APIEvent.SHUTDOWN, () => {
      for (const session in this.ongoingSessions) {
        this.stopStream(session);
      }
    });

    this.options = {
      cameraStreamCount: 2, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: this,
      streamingOptions: {
        supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: [
            [320, 240, 15], // Apple Watch requires this configuration
            [1280, 720, 15],
          ],
          codec: {
            profiles: [H264Profile.MAIN, H264Profile.HIGH],
            levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
          },

        },
        audio: {
          twoWayAudio: false,
          codecs: [
            {
              type: AudioStreamingCodecType.AAC_ELD,
              samplerate: AudioStreamingSamplerate.KHZ_24,
              audioChannels: 1,
              bitrate: 0,
            }
          ]
        }
      },
      recording: {
        delegate: this,
        options: {
          prebufferLength: PROTECT_HKSV_TIMESHIFT_BUFFER_MAXLENGTH,
          mediaContainerConfiguration: {
            type: MediaContainerType.FRAGMENTED_MP4,
            fragmentLength: PROTECT_HKSV_SEGMENT_LENGTH,
          },
          video: {
            type: VideoCodecType.H264,
            parameters: {
              profiles: [H264Profile.MAIN, H264Profile.HIGH],
              levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
            },
            resolutions: [
              [320, 240, 15], // Apple Watch requires this configuration
              [1280, 720, 15],
            ],
          },
          audio: {
            codecs: {
              type: AudioRecordingCodecType.AAC_LC,
              samplerate: AudioRecordingSamplerate.KHZ_24,
            },
          },
        }
      }
    };
  }

  abstract getController(): T;

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    try {
      const snapshot = this.camera.getSnapshot();
      if (!snapshot) {
        return callback(new Error('No snapshot cached'));
      }
      callback(undefined, snapshot);
    } catch (error: any) {
      this.log.error(error);
      callback(error);
    }
  }

  private static determineResolution(request: VideoInfo): ResolutionInfo {
    const width = request.width;
    const height = request.height;

    const filters: Array<string> = [];
    if (width > 0 || height > 0) {
      filters.push('scale=' + (width > 0 ? '\'min(' + width + ',iw)\'' : 'iw') + ':' +
        (height > 0 ? '\'min(' + height + ',ih)\'' : 'ih') +
        ':force_original_aspect_ratio=decrease');
      filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2'); // Force to fit encoder restrictions
    }

    return {
      width: width,
      height: height,
      videoFilter: filters.join(',')
    };
  }

  /**
   * Some callback methods do not log anything if they are called with an error.
   */
  logThenCallback(callback: (error?: Error) => void, message: string) {
    this.log.error(message);
    callback(new Error(message));
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {

    const ipv6 = request.addressVersion === 'ipv6';

    const talkback = this.camera.device.hasCommand(CommandName.DeviceStartTalkback);

    const [videoReturnPort, audioReturnPort] = await reservePorts({ count: 2 });
    const videoSSRC = HAP.CameraController.generateSynchronisationSource();
    const audioSSRC = HAP.CameraController.generateSynchronisationSource();

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
      audioSSRC: audioSSRC,
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

    this.pendingSessions[request.sessionID] = sessionInfo;
    callback(undefined, response);
  }

  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {

    this.log.debug('startStream requested:', request);
    this.log.debug('startStream video codec:', VideoCodecType[request.video.codec]);
    this.log.debug('startStream video profile:', request.video.profile);
    this.log.debug('startStream video level:', request.video.level);

    const talkback = this.camera.device.hasCommand(CommandName.DeviceStartTalkback);

    const sessionInfo = this.pendingSessions[request.sessionID];
    const resolution = StreamingDelegate.determineResolution(request.video);
    const bitrate = request.video.max_bit_rate * 4;
    let vEncoder = this.camera.cameraConfig?.videoConfig?.vcodec ?? 'libx264 -preset ultrafast -tune zerolatency';

    this.log.debug(`Video stream requested: ${request.video.width} x ${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps`);

    const eufyStreamer = await getStreamer(this.camera);

    let ffmpegArgs: string[] = [];
    let eufyStream: EufyStream;

    // ffmpegArgs.push('-fflags', '+discardcorrupt'); // Set format flags to discard any corrupt packets rather than exit
    // ffmpegArgs.push('-flags', 'low_delay'); // Tell FFmpeg to optimize for low delay / realtime decoding
    // ffmpegArgs.push('-avioflags', 'direct'); // Tell FFmpeg to minimize buffering to reduce latency for more realtime processing

    this.log.debug('startStream');
    try {
      eufyStream = await eufyStreamer.initialize(); // '-analyzeduration 15000000 -probesize 100000000 -i ' + streamInfo.streamUrls.rtspUrl;
      // ffmpegArgs.push(...eufyStream.args);
    } catch (error: any) {
      this.logThenCallback(callback, error);
      return;
    }

    if (eufyStream.stdio) {
      ffmpegArgs.push('-f', 'h264');
      ffmpegArgs.push('-i', 'pipe:3');
    }

    // // // Video tweaks
    // // ffmpegArgs.push('-map', '0:v:0');
    // ffmpegArgs.push('-vcodec', 'copy');


    // // Video Stream
    // ffmpegArgs.push('-payload_type', request.video.pt.toString());
    // ffmpegArgs.push('-ssrc', sessionInfo.videoSSRC.toString());
    // ffmpegArgs.push('-f', 'rtp');
    // ffmpegArgs.push('-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80');
    // ffmpegArgs.push('-srtp_out_params', sessionInfo.videoSRTP.toString('base64'));
    // ffmpegArgs.push('srtp://' + sessionInfo.address + ':' + sessionInfo.videoPort + '?rtcpport=' + sessionInfo.videoPort + '&pkt_size=' + request.video.mtu);

    if (eufyStream.stdio) {
      ffmpegArgs.push('-f', 'aac');
      ffmpegArgs.push('-i', 'pipe:4');
    }

    // // // Audio tweaks
    // // ffmpegArgs.push('-map', '0:a:0?');
    // // ffmpegArgs.push('-acodec', 'libfdk_aac');
    // // ffmpegArgs.push('-afterburner', '1');
    // // ffmpegArgs.push('-eld_sbr', '1');
    // // ffmpegArgs.push('-eld_v2', '1');
    // // ffmpegArgs.push('-profile:a', '38');
    // // ffmpegArgs.push('-flags', '+global_header');
    // // ffmpegArgs.push('-f', 'null');
    // // ffmpegArgs.push('-ar', request.audio.sample_rate + 'k');
    // // ffmpegArgs.push('-b:a', request.audio.max_bit_rate + 'k');
    // // ffmpegArgs.push('-ac', request.audio.channel.toString());

    // // Audio Stream
    // ffmpegArgs.push('-payload_type', request.audio.pt.toString());
    // ffmpegArgs.push('-ssrc', sessionInfo.audioSSRC.toString());
    // ffmpegArgs.push('-f', 'rtp');
    // ffmpegArgs.push('-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80');
    // ffmpegArgs.push('-srtp_out_params', sessionInfo.audioSRTP.toString('base64'));
    // ffmpegArgs.push('srtp://' + sessionInfo.address + ':' + sessionInfo.audioPort + '?rtcpport=' + sessionInfo.audioPort + '&pkt_size=188');

    if (this.platform.config.enableDetailedLogging) {
      ffmpegArgs.push('-loglevel', 'level+verbose');
    }

    const activeSession: ActiveSession = { streamer: eufyStreamer };

    try {
      activeSession.socket = createSocket(sessionInfo.ipv6 ? 'udp6' : 'udp4');
      activeSession.socket.on('error', (err: Error) => {
        this.log.error('Socket error: ' + err.name);
        this.stopStream(request.sessionID);
      });
      activeSession.socket.on('message', () => {
        if (activeSession.timeout) {
          clearTimeout(activeSession.timeout);
        }
        activeSession.timeout = setTimeout(() => {
          this.log.debug('Device appears to be inactive. Stopping stream.');
          this.controller.forceStopStreamingSession(request.sessionID);
          this.stopStream(request.sessionID);
        }, request.video.rtcp_interval * 2 * 1000);
      });
      activeSession.socket.bind(sessionInfo.videoReturnPort);
    } catch (error: any) {
      this.logThenCallback(callback, error);
      return;
    }

    activeSession.mainProcess = new FfmpegProcess(request.sessionID, ffmpegArgs, eufyStream.stdio, this.platform.config.enableDetailedLogging, this, callback);

    this.ongoingSessions[request.sessionID] = activeSession;
    delete this.pendingSessions[request.sessionID];
  }

  async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
    switch (request.type) {
      case StreamRequestTypes.START:
        this.startStream(request, callback);
        break;
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug(`Received request to reconfigure: ${request.video.width} x ${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps (Ignored)`);
        callback();
        break;
      case StreamRequestTypes.STOP:
        // await this.stopStream(request.sessionID);
        callback();
        break;
    }
  }

  public async stopStream(sessionId: string): Promise<void> {
    const session = this.ongoingSessions[sessionId];
    if (session) {
      if (session.timeout) {
        clearTimeout(session.timeout);
      }
      try {
        session.socket?.close();
      } catch (err) {
        this.log.error('Error occurred closing socket: ' + err);
      }
      try {
        session.mainProcess?.stop();
      } catch (err) {
        this.log.error('Error occurred terminating main FFmpeg process: ' + err);
      }
      try {
        session.returnProcess?.stop();
      } catch (err) {
        this.log.error('Error occurred terminating two-way FFmpeg process: ' + err);
      }
      try {
        await session.streamer.teardown();
      } catch (err) {
        this.log.error('Error terminating SDM stream: ' + err);
      }
    }

    delete this.ongoingSessions[sessionId];
    this.log.debug('Stopped video stream.');
  }

  closeRecordingStream(streamId: number, reason: HDSProtocolSpecificErrorReason | undefined): void {
    if (this.recordingSessionInfo?.hksvStreamer) {
      this.recordingSessionInfo?.hksvStreamer.destroy();
      this.recordingSessionInfo.eufyStreamer.teardown();
      this.recordingSessionInfo = undefined;
    }
    this.handlingRecordingStreamingRequest = false;
  }


  acknowledgeStream(streamId: number): void {
    this.closeRecordingStream(streamId, undefined);
  }

  /**
   * This is a very minimal, very experimental example on how to implement fmp4 streaming with a
   * CameraController supporting HomeKit Secure Video.
   *
   * An ideal implementation would diverge from this in the following ways:
   * * It would implement a prebuffer and respect the recording `active` characteristic for that.
   * * It would start to immediately record after a trigger event occurred and not just
   *   when the HomeKit Controller requests it (see the documentation of `CameraRecordingDelegate`).
   */
  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {

    this.log.debug('Recording request received.')

    if (!this.cameraRecordingConfiguration)
      throw new Error('No recording configuration for this camera.');

    /**
     * With this flag you can control how the generator reacts to a reset to the motion trigger.
     * If set to true, the generator will send a proper endOfStream if the motion stops.
     * If set to false, the generator will run till the HomeKit Controller closes the stream.
     *
     * Note: In a real implementation you would most likely introduce a bit of a delay.
     */
    const STOP_AFTER_MOTION_STOP = false;

    this.handlingRecordingStreamingRequest = true;

    if (this.cameraRecordingConfiguration.videoCodec.type !== VideoCodecType.H264)
      throw new Error('Unsupported recording codec type.');

    const profile = this.cameraRecordingConfiguration!.videoCodec.parameters.profile === H264Profile.HIGH ? "high"
      : this.cameraRecordingConfiguration!.videoCodec.parameters.profile === H264Profile.MAIN ? "main" : "baseline";

    const level = this.cameraRecordingConfiguration!.videoCodec.parameters.level === H264Level.LEVEL4_0 ? "4.0"
      : this.cameraRecordingConfiguration!.videoCodec.parameters.level === H264Level.LEVEL3_2 ? "3.2" : "3.1";

    const videoArgs: Array<string> = [
      "-an",
      "-sn",
      "-dn",
      "-codec:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",

      "-profile:v", profile,
      "-level:v", level,
      "-b:v", `${this.cameraRecordingConfiguration!.videoCodec.parameters.bitRate}k`,
      "-force_key_frames", `expr:eq(t,n_forced*${this.cameraRecordingConfiguration!.videoCodec.parameters.iFrameInterval / 1000})`,
      "-r", this.cameraRecordingConfiguration!.videoCodec.resolution[2].toString(),
    ];

    let samplerate: string;
    switch (this.cameraRecordingConfiguration!.audioCodec.samplerate) {
      case AudioRecordingSamplerate.KHZ_8:
        samplerate = "8";
        break;
      case AudioRecordingSamplerate.KHZ_16:
        samplerate = "16";
        break;
      case AudioRecordingSamplerate.KHZ_24:
        samplerate = "24";
        break;
      case AudioRecordingSamplerate.KHZ_32:
        samplerate = "32";
        break;
      case AudioRecordingSamplerate.KHZ_44_1:
        samplerate = "44.1";
        break;
      case AudioRecordingSamplerate.KHZ_48:
        samplerate = "48";
        break;
      default:
        throw new Error("Unsupported audio sample rate: " + this.cameraRecordingConfiguration!.audioCodec.samplerate);
    }

    const audioArgs: Array<string> = this.controller?.recordingManagement?.recordingManagementService.getCharacteristic(CHAR.RecordingAudioActive)
      ? [
        "-acodec", "libfdk_aac",
        ...(this.cameraRecordingConfiguration!.audioCodec.type === AudioRecordingCodecType.AAC_LC ?
          ["-profile:a", "aac_low"] :
          ["-profile:a", "aac_eld"]),
        "-ar", `${samplerate}k`,
        "-b:a", `${this.cameraRecordingConfiguration!.audioCodec.bitrate}k`,
        "-ac", `${this.cameraRecordingConfiguration!.audioCodec.audioChannels}`,
      ]
      : [];

    this.log.debug('handleRecordingStreamRequest');
    const eufyStreamer = await getStreamer(this.camera);
    const eufyStream = await eufyStreamer.initialize();
    const hksvStreamer = new HksvStreamer(
      this.log,
      eufyStream,
      audioArgs,
      videoArgs,
      this.platform.config.enableDetailedLogging
    );

    this.recordingSessionInfo = {
      hksvStreamer: hksvStreamer,
      eufyStreamer: eufyStreamer
    }

    await hksvStreamer.start();
    if (!hksvStreamer || hksvStreamer.destroyed) {
      throw new Error('Streaming server already closed.')
    }

    const pending: Array<Buffer> = [];

    try {
      for await (const box of this.recordingSessionInfo.hksvStreamer.generator()) {
        pending.push(box.header, box.data);

        const motionDetected = this.accessory.getService(HAP.Service.MotionSensor)?.getCharacteristic(CHAR.MotionDetected).value;

        this.log.debug("mp4 box type " + box.type + " and length " + box.length);
        if (box.type === "moov" || box.type === "mdat") {
          const fragment = Buffer.concat(pending);
          pending.splice(0, pending.length);

          const isLast = STOP_AFTER_MOTION_STOP && !motionDetected;

          yield {
            data: fragment,
            isLast: isLast,
          };

          if (isLast) {
            this.log.debug("Ending session due to motion stopped!");
            break;
          }
        }
      }
    } catch (error: any) {
      this.log.error("Encountered unexpected error on generator " + error.stack);
    }
  }

  updateRecordingActive(active: boolean): void {
    // we haven't implemented a prebuffer
    this.log.debug("Recording active set to " + active);
  }

  updateRecordingConfiguration(configuration: CameraRecordingConfiguration | undefined): void {
    this.cameraRecordingConfiguration = configuration;
  }
}