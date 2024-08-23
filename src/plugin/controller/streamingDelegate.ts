import {
  AudioStreamingCodecType,
  CameraController,
  CameraStreamingDelegate,
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
import { VideoConfig } from '../utils/configTypes';
import { FFmpeg, FFmpegParameters } from '../utils/ffmpeg';

import { Camera, PropertyName } from 'eufy-security-client';
import { EufySecurityPlatform } from '../platform';

import { LocalLivestreamManager } from './LocalLivestreamManager';
import { SnapshotManager } from './SnapshotManager';
import { TalkbackStream } from '../utils/Talkback';
import { HAP, is_rtsp_ready } from '../utils/utils';
import { reservePorts } from '@homebridge/camera-utils';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { Logger, ILogObj } from 'tslog';

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
  talkbackStream?: TalkbackStream;
};

export class StreamingDelegate implements CameraStreamingDelegate {

  private videoConfig: VideoConfig;
  private controller?: CameraController;
  private platform: EufySecurityPlatform;
  private device: Camera;

  public readonly log: Logger<ILogObj>;

  private localLivestreamManager: LocalLivestreamManager;
  private snapshotManager: SnapshotManager;

  // keep track of sessions
  pendingSessions: Map<string, SessionInfo> = new Map();
  ongoingSessions: Map<string, ActiveSession> = new Map();
  timeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private camera: CameraAccessory,
  ) {
    this.platform = camera.platform;
    this.device = camera.device;

    this.videoConfig = camera.cameraConfig.videoConfig!;

    this.log = camera.log;

    this.localLivestreamManager = new LocalLivestreamManager(camera);

    this.snapshotManager = new SnapshotManager(
      this.camera,
      this.localLivestreamManager,
    );

  }

  public setController(controller: CameraController) {
    this.controller = controller;
  }

  public getLivestreamManager(): LocalLivestreamManager {
    return this.localLivestreamManager;
  }

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    this.log.debug('handleSnapshotRequest');

    try {
      this.log.debug('Snapshot requested: ' + request.width + ' x ' + request.height, this.videoConfig.debug!);

      const snapshot = await this.snapshotManager.getSnapshotBufferResized(request);

      this.log.debug('snapshot byte lenght: ' + snapshot?.byteLength);

      callback(undefined, snapshot);
    } catch (error) {
      this.log.error(error as string);
      callback();
    }
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
    const ipv6 = request.addressVersion === 'ipv6';

    this.log.debug(`stream prepare request with session id ${request.sessionID} was received.`);

    const [videoReturnPort, audioReturnPort] = await reservePorts({ type: 'udp', count: 2 });

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

  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {
    const sessionInfo = this.pendingSessions.get(request.sessionID);

    if (!sessionInfo) {
      this.log.error('Error finding session information.');
      callback(new Error('Error finding session information'));
    }

    this.log.debug('VIDEOCONFIG: ', this.videoConfig);

    try {
      const activeSession: ActiveSession = {};
      activeSession.socket = createSocket(sessionInfo!.ipv6 ? 'udp6' : 'udp4');
      activeSession.socket.on('error', (err: Error) => {
        this.log.error('Socket error: ' + err.message);
        this.stopStream(request.sessionID);
      });
      activeSession.socket.on('message', () => {
        if (activeSession.timeout) {
          clearTimeout(activeSession.timeout);
        }
        activeSession.timeout = setTimeout(() => {
          this.log.debug('Device appears to be inactive. Stopping video stream.');
          this.controller?.forceStopStreamingSession(request.sessionID);
          this.stopStream(request.sessionID);
        }, request.video.rtcp_interval * 5 * 1000);
      });
      activeSession.socket.bind(sessionInfo!.videoReturnPort);

      // get streams
      const videoParams = await FFmpegParameters.forVideo(this.videoConfig.debug);
      videoParams.setup(this.camera.cameraConfig, request);
      videoParams.setRTPTarget(sessionInfo!, request);

      const useAudio = (request.audio.codec === AudioStreamingCodecType.OPUS
        || request.audio.codec === AudioStreamingCodecType.AAC_ELD)
        && this.videoConfig.audio;

      if (!useAudio && this.videoConfig.audio) {
        this.log.warn(`An unsupported audio codec (type: ${request.audio.codec}) was requested. Audio streaming will be omitted.`);
      }

      let audioParams: FFmpegParameters | undefined = undefined;
      if (useAudio) {
        audioParams = await FFmpegParameters.forAudio(this.videoConfig.debug);
        audioParams.setup(this.camera.cameraConfig, request);
        audioParams.setRTPTarget(sessionInfo!, request);
      }

      const rtsp = is_rtsp_ready(this.device, this.camera.cameraConfig);

      if (rtsp) {
        const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
        this.log.debug('RTSP URL: ' + url);
        videoParams.setInputSource(url as string);
        audioParams?.setInputSource(url as string);
      } else {
        try {
          const streamData = await this.localLivestreamManager.getLocalLivestream().catch((error) => {
            throw error;
          });
          await videoParams.setInputStream(streamData.videostream);
          await audioParams?.setInputStream(streamData.audiostream);
        } catch (error) {
          this.log.error(('Unable to start the livestream: ' + error) as string);
          callback(error as Error);
          this.pendingSessions.delete(request.sessionID);
          return;
        }
      }

      const useSeparateProcesses = this.videoConfig.useSeparateProcesses ??= false;

      const videoProcess = new FFmpeg(
        `[Video Process]`,
        !useSeparateProcesses && audioParams ? [videoParams, audioParams] : videoParams,
      );
      videoProcess.on('started', () => {
        callback();
      });
      videoProcess.on('error', (error) => {
        this.log.error('Video process ended with error: ' + error);
        this.stopStream(request.sessionID);
      });
      activeSession.videoProcess = videoProcess;
      activeSession.videoProcess.start();

      if (useSeparateProcesses && audioParams) {
        const audioProcess = new FFmpeg(
          `[Audio Process]`,
          audioParams,
        );
        audioProcess.on('error', (error) => { // TODO: better reestablish connection
          this.log.error('Audio process ended with error: ' + error);
          this.stopStream(request.sessionID);
        });
        activeSession.audioProcess = audioProcess;
        activeSession.audioProcess.start();
      }

      if (this.camera.cameraConfig.talkback) {
        const talkbackParameters = await FFmpegParameters.forAudio(this.videoConfig.debug);
        await talkbackParameters.setTalkbackInput(sessionInfo!);
        if (this.camera.cameraConfig.talkbackChannels) {
          talkbackParameters.setTalkbackChannels(this.camera.cameraConfig.talkbackChannels);
        }
        activeSession.talkbackStream = new TalkbackStream(this.platform, this.device);
        activeSession.returnProcess = new FFmpeg(
          `[Talkback Process]`,
          talkbackParameters,
        );
        activeSession.returnProcess.on('error', (error) => {
          this.log.error('Talkback process ended with error: ' + error);
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
        this.log.info('pendingSession has been deleted. Add it to ongoingSession and end it immediately.');
        this.stopStream(request.sessionID);
      }

    } catch (error) {
      this.log.error('Stream could not be started: ' + error);
      callback(error as Error);
      this.pendingSessions.delete(request.sessionID);
    }
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    switch (request.type) {
      case StreamRequestTypes.START:
        this.log.debug(`Received request to start stream with id ${request.sessionID}`);
        this.log.debug(`request data:`, request);
        this.startStream(request, callback);
        break;
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug(
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
        this.log.debug('Receive Apple HK Stop request', request);
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
      } catch (error) {
        this.log.error('Error occurred terminating returnAudio FFmpeg process: ' + error);
      }
      try {
        session.videoProcess?.stop();
      } catch (error) {
        this.log.error('Error occurred terminating video FFmpeg process: ' + error);
      }
      try {
        session.audioProcess?.stop();
      } catch (error) {
        this.log.error('Error occurred terminating audio FFmpeg process: ' + error);
      }
      try {
        session.socket?.close();
      } catch (error) {
        this.log.error('Error occurred closing socket: ' + error);
      }
      try {
        if (!is_rtsp_ready(this.device, this.camera.cameraConfig)) {
          this.localLivestreamManager.stopLocalLiveStream();
        }
      } catch (error) {
        this.log.error('Error occurred terminating Eufy Station livestream: ' + error);
      }

      this.ongoingSessions.delete(sessionId);
      this.log.info('Stopped video stream.');
    } else {
      this.log.debug('No session to stop.');
    }
  }
}