import {
  AudioStreamingCodecType,
  CameraController,
  CameraStreamingDelegate,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SnapshotRequest,
  SnapshotRequestCallback,
  StartStreamRequest,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes,
} from 'homebridge';
import { createSocket, Socket } from 'dgram';
import { Logger, ILogObj } from 'tslog';
import { pickPort } from 'pick-port';
import { Camera, PropertyName } from 'eufy-security-client';

import { EufySecurityPlatform } from '../platform';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { SessionInfo, VideoConfig } from '../utils/configTypes';
import { FFmpeg, FFmpegParameters } from '../utils/ffmpeg';
import { TalkbackStream } from '../utils/Talkback';
import { HAP, is_rtsp_ready } from '../utils/utils';
import { LocalLivestreamManager } from './LocalLivestreamManager';
import { SnapshotManager } from './SnapshotManager';

// Re-export for backward compatibility
export type { SessionInfo } from '../utils/configTypes';

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
      this.log.debug(`Snapshot requested: ${request.width}x${request.height}`);

      const snapshot = await this.snapshotManager.getSnapshotBufferResized(request);

      this.log.debug('Snapshot byte length: ' + snapshot?.byteLength);

      callback(undefined, snapshot);
    } catch (error) {
      this.log.error(error as string);
      callback();
    }
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
    this.log.debug(`stream prepare request with session id ${request.sessionID} was received.`);

    const [videoReturnPort, audioReturnPort] = await Promise.all([
      pickPort({ type: 'udp' }),
      pickPort({ type: 'udp' }),
    ]);

    const videoSSRC = HAP.CameraController.generateSynchronisationSource();
    const audioSSRC = HAP.CameraController.generateSynchronisationSource();

    const sessionInfo: SessionInfo = {
      address: request.targetAddress,
      ipv6: request.addressVersion === 'ipv6',
      videoPort: request.video.port,
      videoReturnPort,
      videoCryptoSuite: request.video.srtpCryptoSuite,
      videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC,
      audioPort: request.audio.port,
      audioReturnPort,
      audioCryptoSuite: request.audio.srtpCryptoSuite,
      audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSSRC,
    };

    this.pendingSessions.set(request.sessionID, sessionInfo);

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

    callback(undefined, response);
  }

  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {
    const sessionInfo = this.pendingSessions.get(request.sessionID);

    if (!sessionInfo) {
      this.log.error('Error finding session information.');
      callback(new Error('Error finding session information'));
      return;
    }

    this.log.debug('VIDEOCONFIG: ', this.videoConfig);

    try {
      const activeSession: ActiveSession = {};

      activeSession.socket = this.createKeepAliveSocket(sessionInfo, request, activeSession);

      const { videoParams, audioParams } = await this.buildStreamParameters(sessionInfo, request);

      await this.configureStreamInput(videoParams, audioParams);

      this.startFFmpegProcesses(activeSession, videoParams, audioParams, request, callback);

      await this.setupTalkback(activeSession, sessionInfo);

      this.finalizeSession(request.sessionID, activeSession);

    } catch (error) {
      this.log.error('Stream could not be started: ' + error);
      callback(error as Error);
      this.pendingSessions.delete(request.sessionID);
    }
  }

  /**
   * Creates a UDP socket that monitors RTCP keep-alive messages.
   * If no message is received within 5x the RTCP interval, the stream is considered inactive.
   */
  private createKeepAliveSocket(
    sessionInfo: SessionInfo,
    request: StartStreamRequest,
    activeSession: ActiveSession,
  ): Socket {
    const socket = createSocket(sessionInfo.ipv6 ? 'udp6' : 'udp4');

    socket.on('error', (err: Error) => {
      this.log.error('Socket error: ' + err.message);
      this.stopStream(request.sessionID);
    });

    socket.on('message', () => {
      if (activeSession.timeout) {
        clearTimeout(activeSession.timeout);
      }
      activeSession.timeout = setTimeout(() => {
        this.log.debug('Device appears to be inactive. Stopping video stream.');
        this.controller?.forceStopStreamingSession(request.sessionID);
        this.stopStream(request.sessionID);
      }, request.video.rtcp_interval * 5 * 1000);
    });

    socket.bind(sessionInfo.videoReturnPort);
    return socket;
  }

  /**
   * Builds FFmpeg parameters for video and (optionally) audio streams.
   */
  private async buildStreamParameters(
    sessionInfo: SessionInfo,
    request: StartStreamRequest,
  ): Promise<{ videoParams: FFmpegParameters; audioParams?: FFmpegParameters }> {
    const videoParams = await FFmpegParameters.forVideo(this.videoConfig.debug);
    videoParams.setup(this.camera.cameraConfig, request);
    videoParams.setRTPTarget(sessionInfo, request);

    const isCodecSupported = request.audio.codec === AudioStreamingCodecType.OPUS
      || request.audio.codec === AudioStreamingCodecType.AAC_ELD;

    if (!isCodecSupported && this.videoConfig.audio) {
      this.log.warn(`An unsupported audio codec (type: ${request.audio.codec}) was requested. Audio streaming will be omitted.`);
    }

    let audioParams: FFmpegParameters | undefined;
    if (isCodecSupported && this.videoConfig.audio) {
      audioParams = await FFmpegParameters.forAudio(this.videoConfig.debug);
      audioParams.setup(this.camera.cameraConfig, request);
      audioParams.setRTPTarget(sessionInfo, request);
    }

    return { videoParams, audioParams };
  }

  /**
   * Configures the input source (RTSP URL or P2P livestream) for the FFmpeg parameters.
   */
  private async configureStreamInput(
    videoParams: FFmpegParameters,
    audioParams?: FFmpegParameters,
  ): Promise<void> {
    if (is_rtsp_ready(this.device, this.camera.cameraConfig)) {
      const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) as string;
      this.log.debug('RTSP URL: ' + url);
      videoParams.setInputSource(url);
      audioParams?.setInputSource(url);
    } else {
      this.log.debug(
        `Using P2P local livestream for ${this.device.getName()} ` +
        `(serial: ${this.device.getSerial()}, type: ${this.device.getDeviceType()})`,
      );
      const streamData = await this.localLivestreamManager.getLocalLivestream();
      this.log.debug('Livestream obtained successfully. Setting up FFmpeg input streams...');
      await videoParams.setInputStream(streamData.videostream);
      await audioParams?.setInputStream(streamData.audiostream);
      this.log.debug('FFmpeg input streams configured.');
    }
  }

  /**
   * Starts the video (and optionally separate audio) FFmpeg processes.
   */
  private startFFmpegProcesses(
    activeSession: ActiveSession,
    videoParams: FFmpegParameters,
    audioParams: FFmpegParameters | undefined,
    request: StartStreamRequest,
    callback: StreamRequestCallback,
  ): void {
    const useSeparateProcesses = this.videoConfig.useSeparateProcesses ?? false;

    const videoProcess = new FFmpeg(
      '[Video Process]',
      !useSeparateProcesses && audioParams ? [videoParams, audioParams] : videoParams,
    );
    videoProcess.on('started', () => callback());
    videoProcess.on('error', (error) => {
      this.log.error('Video process ended with error: ' + error);
      this.stopStream(request.sessionID);
    });
    activeSession.videoProcess = videoProcess;
    videoProcess.start();

    if (useSeparateProcesses && audioParams) {
      const audioProcess = new FFmpeg('[Audio Process]', audioParams);
      audioProcess.on('error', (error) => {
        this.log.error('Audio process ended with error: ' + error);
        this.stopStream(request.sessionID);
      });
      activeSession.audioProcess = audioProcess;
      audioProcess.start();
    }
  }

  /**
   * Sets up talkback (return audio) if enabled in the camera config.
   */
  private async setupTalkback(activeSession: ActiveSession, sessionInfo: SessionInfo): Promise<void> {
    if (!this.camera.cameraConfig.talkback) {
      return;
    }

    const talkbackParams = await FFmpegParameters.forAudio(this.videoConfig.debug);
    await talkbackParams.setTalkbackInput(sessionInfo);

    if (this.camera.cameraConfig.talkbackChannels) {
      talkbackParams.setTalkbackChannels(this.camera.cameraConfig.talkbackChannels);
    }

    activeSession.talkbackStream = new TalkbackStream(this.platform, this.device);
    activeSession.returnProcess = new FFmpeg('[Talkback Process]', talkbackParams);
    activeSession.returnProcess.on('error', (error) => {
      this.log.error('Talkback process ended with error: ' + error);
    });
    activeSession.returnProcess.start();
    activeSession.returnProcess.stdout?.pipe(activeSession.talkbackStream);
  }

  /**
   * Transfers session from pending to ongoing, or stops it immediately if it was cancelled.
   */
  private finalizeSession(sessionId: string, activeSession: ActiveSession): void {
    const pendingSession = this.pendingSessions.get(sessionId);
    this.ongoingSessions.set(sessionId, activeSession);

    if (pendingSession) {
      this.pendingSessions.delete(sessionId);
    } else {
      this.log.info('Session was cancelled before start completed. Stopping immediately.');
      this.stopStream(sessionId);
    }
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    switch (request.type) {
      case StreamRequestTypes.START:
        this.log.debug(`Received request to start stream with id ${request.sessionID}`, request);
        this.startStream(request, callback);
        break;
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug(
          `Reconfigure request: ${request.video.width}x${request.video.height}, ` +
          `${request.video.fps} fps, ${request.video.max_bit_rate} kbps (Ignored)`,
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

    this.pendingSessions.delete(sessionId);

    const session = this.ongoingSessions.get(sessionId);
    if (!session) {
      this.log.debug('No session to stop.');
      return;
    }

    if (session.timeout) {
      clearTimeout(session.timeout);
    }

    const cleanupSteps: Array<[string, () => void]> = [
      ['returnAudio FFmpeg process', () => {
        session.talkbackStream?.stopTalkbackStream();
        session.returnProcess?.stdout?.unpipe();
        session.returnProcess?.stop();
      }],
      ['video FFmpeg process', () => session.videoProcess?.stop()],
      ['audio FFmpeg process', () => session.audioProcess?.stop()],
      ['socket', () => session.socket?.close()],
      ['Eufy Station livestream', () => {
        if (!is_rtsp_ready(this.device, this.camera.cameraConfig)) {
          this.localLivestreamManager.stopLocalLiveStream();
        }
      }],
    ];

    for (const [label, cleanup] of cleanupSteps) {
      try {
        cleanup();
      } catch (error) {
        this.log.error(`Error occurred terminating ${label}: ${error}`);
      }
    }

    this.ongoingSessions.delete(sessionId);
    this.log.info('Stopped video stream.');
  }
}