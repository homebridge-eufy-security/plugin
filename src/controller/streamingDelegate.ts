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

import { CameraAccessory } from '../accessories/CameraAccessory.js';
import { SessionInfo, VideoConfig } from '../utils/configTypes.js';
import { FFmpeg, FFmpegParameters } from '../utils/ffmpeg.js';
import { TalkbackStream } from '../utils/Talkback.js';
import { HAP, isRtspReady } from '../utils/utils.js';
import { LocalLivestreamManager } from './LocalLivestreamManager.js';
import { snapshotDelegate } from './snapshotDelegate.js';

type ActiveSession = {
  videoProcess?: FFmpeg;
  audioProcess?: FFmpeg;
  returnProcess?: FFmpeg;
  timeout?: NodeJS.Timeout;
  socket?: Socket;
  talkbackStream?: TalkbackStream;
};

export class StreamingDelegate implements CameraStreamingDelegate {

  private controller?: CameraController;

  private readonly log: Logger<ILogObj>;

  private readonly localLivestreamManager: LocalLivestreamManager;
  private readonly snapshotDelegate: snapshotDelegate;

  // keep track of sessions
  private readonly pendingSessions = new Map<string, SessionInfo>();
  private readonly ongoingSessions = new Map<string, ActiveSession>();

  private get device(): Camera {
    return this.camera.device;
  }

  private get videoConfig(): VideoConfig {
    return this.camera.cameraConfig.videoConfig!;
  }

  constructor(
    private camera: CameraAccessory,
  ) {
    this.log = camera.log;

    this.localLivestreamManager = new LocalLivestreamManager(camera);

    this.snapshotDelegate = new snapshotDelegate(
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
    this.log.debug(`Snapshot requested: ${request.width}x${request.height}`);

    try {
      const snapshot = await this.snapshotDelegate.getSnapshotBufferResized(request);
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

    const srtpBuffer = (m: PrepareStreamRequest['video']) => Buffer.concat([m.srtp_key, m.srtp_salt]);

    const sessionInfo: SessionInfo = {
      address: request.targetAddress,
      ipv6: request.addressVersion === 'ipv6',
      videoPort: request.video.port,
      videoReturnPort,
      videoCryptoSuite: request.video.srtpCryptoSuite,
      videoSRTP: srtpBuffer(request.video),
      videoSSRC,
      audioPort: request.audio.port,
      audioReturnPort,
      audioCryptoSuite: request.audio.srtpCryptoSuite,
      audioSRTP: srtpBuffer(request.audio),
      audioSSRC,
    };

    this.pendingSessions.set(request.sessionID, sessionInfo);

    const response: PrepareStreamResponse = {
      video: this.buildMediaResponse(videoReturnPort, videoSSRC, request.video),
      audio: this.buildMediaResponse(audioReturnPort, audioSSRC, request.audio),
    };

    callback(undefined, response);
  }

  private buildMediaResponse(
    returnPort: number,
    ssrc: number,
    media: PrepareStreamRequest['video'],
  ): PrepareStreamResponse['video'] {
    return {
      port: returnPort,
      ssrc,
      srtp_key: media.srtp_key,
      srtp_salt: media.srtp_salt,
    };
  }

  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {
    const sessionInfo = this.pendingSessions.get(request.sessionID);

    if (!sessionInfo) {
      this.log.error('Error finding session information.');
      callback(new Error('Error finding session information'));
      return;
    }

    try {
      const activeSession: ActiveSession = {};

      activeSession.socket = this.createKeepAliveSocket(sessionInfo, request, activeSession);

      const { videoParams, audioParams } = await this.buildStreamParameters(sessionInfo, request);

      await this.configureStreamInput(videoParams, audioParams);

      await this.startFFmpegProcesses(activeSession, videoParams, audioParams, request, callback);

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
    if (isRtspReady(this.device, this.camera.cameraConfig)) {
      const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) as string;
      this.log.debug('RTSP URL: ' + url);
      videoParams.setInputSource(url);
      audioParams?.setInputSource(url);
    } else {
      this.log.debug(
        `Using P2P local livestream for ${this.device.getName()} ` +
        `(serial: ${this.device.getSerial()}, type: ${this.device.getDeviceType()})`,
      );
      const streamData = await this.localLivestreamManager.getLocalLiveStream();
      this.log.debug('Livestream obtained successfully. Setting up FFmpeg input streams...');
      await videoParams.setInputStream(streamData.videostream);
      await audioParams?.setInputStream(streamData.audiostream);
      this.log.debug('FFmpeg input streams configured.');
    }
  }

  /**
   * Starts the video (and optionally separate audio) FFmpeg processes.
   */
  private async startFFmpegProcesses(
    activeSession: ActiveSession,
    videoParams: FFmpegParameters,
    audioParams: FFmpegParameters | undefined,
    request: StartStreamRequest,
    callback: StreamRequestCallback,
  ): Promise<void> {
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
    await videoProcess.start();

    if (useSeparateProcesses && audioParams) {
      const audioProcess = new FFmpeg('[Audio Process]', audioParams);
      audioProcess.on('error', (error) => {
        this.log.error('Audio process ended with error: ' + error);
        this.stopStream(request.sessionID);
      });
      activeSession.audioProcess = audioProcess;
      await audioProcess.start();
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

    activeSession.talkbackStream = new TalkbackStream(this.camera.platform, this.device);
    activeSession.returnProcess = new FFmpeg('[Talkback Process]', talkbackParams);
    activeSession.returnProcess.on('error', (error) => {
      this.log.error('Talkback process ended with error: ' + error);
    });
    await activeSession.returnProcess.start();
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
        if (!isRtspReady(this.device, this.camera.cameraConfig)) {
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