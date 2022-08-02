/* eslint-disable max-len */
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
} from 'homebridge';
import { createSocket, Socket } from 'dgram';
import pickPort, { pickPortOptions } from 'pick-port';
import { CameraConfig, VideoConfig } from '../utils/configTypes';
import { FFmpeg, FFmpegParameters } from '../utils/ffmpeg';
import { Logger } from '../utils/logger';

import { Station, Device, Camera, PropertyName } from 'eufy-security-client';
import { EufySecurityPlatform } from '../platform';

import { LocalLivestreamManager } from './LocalLivestreamManager';
import { SnapshotManager } from './SnapshotManager';
import { TalkbackStream } from '../utils/Talkback';
import { is_rtsp_ready } from '../utils/utils';

export type SessionInfo = {
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
  videoProcess?: FFmpeg;
  audioProcess?: FFmpeg;
  returnProcess?: FFmpeg;
  timeout?: NodeJS.Timeout;
  socket?: Socket;
  cachedStreamId?: number;
  talkbackStream?: TalkbackStream;
};

export class StreamingDelegate implements CameraStreamingDelegate {
  private readonly hap: HAP;
  private readonly api: API;
  private readonly log: Logger;
  private readonly cameraName: string;
  private cameraConfig: CameraConfig;
  private videoConfig: VideoConfig;
  readonly controller: CameraController;

  private readonly platform: EufySecurityPlatform;
  private readonly device: Camera;

  private localLivestreamManager: LocalLivestreamManager;
  private snapshotManager: SnapshotManager;

  // keep track of sessions
  pendingSessions: Map<string, SessionInfo> = new Map();
  ongoingSessions: Map<string, ActiveSession> = new Map();
  timeouts: Map<string, NodeJS.Timeout> = new Map();

  // eslint-disable-next-line max-len
  constructor(platform: EufySecurityPlatform, device: Camera, cameraConfig: CameraConfig, api: API, hap: HAP) {
    // eslint-disable-line @typescript-eslint/explicit-module-boundary-types
    this.log = platform.log;
    this.hap = hap;
    this.api = api;

    this.platform = platform;
    this.device = device;

    this.cameraName = device.getName()!;

    this.cameraConfig = cameraConfig;
    this.videoConfig = cameraConfig.videoConfig!;

    this.localLivestreamManager = new LocalLivestreamManager(
      this.platform,
      this.device,
      this.cameraConfig.useCachedLocalLivestream,
      this.log,
    );

    this.snapshotManager = new SnapshotManager(this.platform, this.device, this.cameraConfig, this.localLivestreamManager, this.log);

    this.api.on(APIEvent.SHUTDOWN, () => {
      for (const session in this.ongoingSessions) {
        this.stopStream(session);
      }
      this.localLivestreamManager.stopLocalLiveStream();
    });

    let samplerate = AudioStreamingSamplerate.KHZ_16;
    if (this.videoConfig.audioSampleRate === 8) {
      samplerate = AudioStreamingSamplerate.KHZ_8;
    } else if (this.videoConfig.audioSampleRate === 24) {
      samplerate = AudioStreamingSamplerate.KHZ_24;
    }

    this.log.debug(this.cameraName, `Audio sample rate set to ${samplerate} kHz.`);

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
            [1600, 1200, 30],
          ],
          codec: {
            profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
            levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
          },
        },
        audio: {
          twoWayAudio: this.cameraConfig.talkback,
          codecs: [
            {
              type: AudioStreamingCodecType.AAC_ELD,
              samplerate: samplerate,
              /*type: AudioStreamingCodecType.OPUS,
                            samplerate: AudioStreamingSamplerate.KHZ_24*/
            },
          ],
        },
      },
    };

    this.controller = new hap.CameraController(options);
  }

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    this.log.debug('handleSnapshotRequest');

    try {
      this.log.debug('Snapshot requested: ' + request.width + ' x ' + request.height, this.cameraName, this.videoConfig.debug);

      const snapshot = await this.snapshotManager.getSnapshotBuffer(request);

      this.log.debug('snapshot byte lenght: ' + snapshot?.byteLength);

      callback(undefined, snapshot);
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
      reserveTimeout: 15,
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
      audioSSRC: audioSSRC,
    };

    const response: PrepareStreamResponse = {
      video: {
        port: videoReturnPort,
        ssrc: videoSSRC,

        srtp_key: request.video.srtp_key,
        srtp_salt: request.video.srtp_salt,
      },
      audio: {
        port: audioReturnPort,
        ssrc: audioSSRC,

        srtp_key: request.audio.srtp_key,
        srtp_salt: request.audio.srtp_salt,
      },
    };

    this.pendingSessions.set(request.sessionID, sessionInfo);
    callback(undefined, response);
  }

  public async prepareCachedStream(): Promise<void> {
    if (!is_rtsp_ready(this.device, this.cameraConfig, this.log)) {
      const proxyStream = await this.localLivestreamManager.getLocalLivestream();
      this.localLivestreamManager.stopProxyStream(proxyStream.id);
    }
  }

  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {
    const sessionInfo = this.pendingSessions.get(request.sessionID);

    if (!sessionInfo) {
      this.log.error(this.cameraName, 'Error finding session information.');
      callback(new Error('Error finding session information'));
    }

    this.log.debug(this.cameraName, 'VIDEOCONFIG: ' + JSON.stringify(this.videoConfig));

    try {
      const activeSession: ActiveSession = {};
      activeSession.socket = createSocket(sessionInfo!.ipv6 ? 'udp6' : 'udp4');
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
      activeSession.socket.bind(sessionInfo!.videoReturnPort);

      // get streams
      const videoParams = await FFmpegParameters.forVideo(this.videoConfig.debug);
      videoParams.setup(this.cameraConfig, request);
      videoParams.setRTPTarget(sessionInfo!, request);

      const useAudio = (request.audio.codec === AudioStreamingCodecType.OPUS
                      || request.audio.codec === AudioStreamingCodecType.AAC_ELD)
                      && this.videoConfig.audio;
      
      if (!useAudio && this.videoConfig.audio) {
        this.log.warn(this.cameraName, `An unsupported audio codec (type: ${request.audio.codec}) was requested. Audio streaming will be omitted.`);
      }

      let audioParams: FFmpegParameters | undefined = undefined;
      if (useAudio) {
        audioParams = await FFmpegParameters.forAudio(this.videoConfig.debug);
        audioParams.setup(this.cameraConfig, request);
        audioParams.setRTPTarget(sessionInfo!, request);
      }

      const rtsp = is_rtsp_ready(this.device, this.cameraConfig, this.log);

      if (rtsp) {
        const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
        this.platform.log.debug(this.cameraName, 'RTSP URL: ' + url);
        videoParams.setInputSource(url as string);
        audioParams?.setInputSource(url as string);
      } else {
        try {
          const streamData = await this.localLivestreamManager.getLocalLivestream().catch((err) => {
            throw err;
          });
          activeSession.cachedStreamId = streamData.id;
          await videoParams.setInputStream(streamData.videostream);
          await audioParams?.setInputStream(streamData.audiostream);
        } catch (err) {
          this.log.error((this.cameraName + ' Unable to start the livestream: ' + err) as string);
          callback(err as Error);
          this.pendingSessions.delete(request.sessionID);
          return;
        }
      }

      const useSeparateProcesses = this.videoConfig.useSeparateProcesses ??= false;

      const videoProcess = new FFmpeg(
        `[${this.cameraName}] [Video Process]`,
        !useSeparateProcesses && audioParams ? [videoParams, audioParams] : videoParams,
        this.log,
      );
      videoProcess.on('started', () => {
        callback();
      });
      videoProcess.on('error', (err) => {
        this.log.error(this.cameraName, 'Video process ended with error: ' + err);
        this.stopStream(request.sessionID);
      });
      activeSession.videoProcess = videoProcess;
      activeSession.videoProcess.start();

      if (useSeparateProcesses && audioParams) {
        const audioProcess = new FFmpeg(
          `[${this.cameraName}] [Audio Process]`,
          audioParams,
          this.log,
        );
        audioProcess.on('error', (err) => { // TODO: better reestablish connection
          this.log.error(this.cameraName, 'Audio process ended with error: ' + err);
          this.stopStream(request.sessionID);
        });
        activeSession.audioProcess = audioProcess;
        activeSession.audioProcess.start();
      }

      if (this.cameraConfig.talkback) {
        const talkbackParameters = await FFmpegParameters.forAudio(this.videoConfig.debug);
        await talkbackParameters.setTalkbackInput(sessionInfo!);
        activeSession.talkbackStream = new TalkbackStream(this.platform, this.device);
        activeSession.returnProcess = new FFmpeg(
          `[${this.cameraName}] [Talkback Process]`,
          talkbackParameters,
          this.log,
        );
        activeSession.returnProcess.on('error', (err) => {
          this.log.error(this.cameraName, 'Talkback process ended with error: ' + err);
        });
        activeSession.returnProcess.start();
        activeSession.returnProcess.stdout?.pipe(activeSession.talkbackStream);
      }
    
      // Check if the pendingSession has been stopped before it was successfully started.
      const pendingSession = this.pendingSessions.get(request.sessionID);
      // pendingSession has not been deleted. Transfer it to ongoingSessions.
      if (pendingSession) {
        this.ongoingSessions.set(request.sessionID, activeSession);
        this.pendingSessions.delete(request.sessionID);
      } else { // pendingSession has been deleted. Add it to ongoingSession and end it immediately.
        this.ongoingSessions.set(request.sessionID, activeSession);
        this.log.info(this.cameraName, 'pendingSession has been deleted. Add it to ongoingSession and end it immediately.');
        this.stopStream(request.sessionID);
      }

    } catch (err) {
      this.log.error(this.cameraName, 'Stream could not be started: ' + err);
      callback(err as Error);
      this.pendingSessions.delete(request.sessionID);
    }
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    switch (request.type) {
      case StreamRequestTypes.START:
        this.startStream(request, callback);
        break;
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug(
          this.cameraName,
          'Received request to reconfigure: ' +
            request.video.width +
            ' x ' +
            request.video.height +
            ', ' +
            request.video.fps +
            ' fps, ' +
            request.video.max_bit_rate +
            ' kbps (Ignored)',
          this.videoConfig.debug,
        );
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
        session.talkbackStream?.stopTalkbackStream();
        session.returnProcess?.stdout?.unpipe();
        session.returnProcess?.stop();
      } catch (err) {
          this.log.error(this.cameraName, 'Error occurred terminating returnAudio FFmpeg process: ' + err);
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
        if (!is_rtsp_ready(this.device, this.cameraConfig, this.log) && session.cachedStreamId) {
          this.localLivestreamManager.stopProxyStream(session.cachedStreamId);
        }
      } catch (err) {
        this.log.error(this.cameraName, 'Error occurred terminating Eufy Station livestream: ' + err);
      }

      this.ongoingSessions.delete(sessionId);
      this.log.info(this.cameraName, 'Stopped video stream.');
    } else {
      this.log.debug('No session to stop.');
    }
  }
}
