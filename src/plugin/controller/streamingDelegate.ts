/* eslint-disable max-len */
/* eslint-disable indent */
import {
  API,
  APIEvent,
  AudioStreamingCodecType,
  CameraController,
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

import { CameraConfig, VideoConfig } from '../utils/configTypes';
import { FFmpeg } from '../utils/ffmpeg';
import { FFmpegParameters } from '../utils/ffmpeg-params';
import { Logger as TsLogger, ILogObj } from 'tslog';

import { Camera, PropertyName } from 'eufy-security-client';
import { EufySecurityPlatform } from '../platform';

import { SnapshotManager } from './SnapshotManager';
import { TalkbackStream } from '../utils/Talkback';
import { is_rtsp_ready } from '../utils/utils';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { LocalLivestreamManager, StationStream } from './LocalLivestreamManager';
import { Writable } from 'stream';

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
  talkbackStream?: TalkbackStream;
};

export class StreamingDelegate implements CameraStreamingDelegate {

  public readonly platform: EufySecurityPlatform;
  public readonly device: Camera;
  public readonly cameraConfig: CameraConfig;

  private readonly hap: HAP;
  private readonly api: API;
  private readonly log: TsLogger<ILogObj>;
  public readonly cameraName: string;

  private readonly videoConfig: VideoConfig;
  private controller?: CameraController;

  public readonly localLivestreamManager: LocalLivestreamManager = new LocalLivestreamManager(this);

  private snapshotManager: SnapshotManager = new SnapshotManager(this);

  // keep track of sessions
  pendingSessions: Map<string, SessionInfo> = new Map();
  ongoingSessions: Map<string, ActiveSession> = new Map();
  timeouts: Map<string, NodeJS.Timeout> = new Map();

  // eslint-disable-next-line max-len
  constructor(
    public readonly camera: CameraAccessory,
  ) {
    this.platform = this.camera.platform;
    this.device = this.camera.device;
    this.cameraConfig = this.camera.cameraConfig;

    this.hap = this.platform.api.hap;
    this.api = this.platform.api;
    this.log = this.platform.log;
    this.cameraName = this.device.getName()!;
  
    this.videoConfig = this.cameraConfig.videoConfig!;

    this.api.on(APIEvent.SHUTDOWN, () => {
      for (const session in this.ongoingSessions) {
        this.stopStream(session);
      }
      this.log.debug(this.cameraName, 'Streaming STOP! API shutdown!');
      this.localLivestreamManager.stopLocalLiveStream();
    });
  }

  public setController(controller: CameraController) {
    this.controller = controller;
  }

  public getLivestreamManager(): LocalLivestreamManager {
    return this.localLivestreamManager;
  }

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    this.log.debug(this.cameraName, 'handleSnapshotRequest');

    try {
      this.log.debug(this.cameraName, 'Snapshot requested: ' + request.width + ' x ' + request.height, this.videoConfig.debug);

      const snapshot = await this.snapshotManager.getSnapshotBuffer(request);

      this.log.debug(this.cameraName, 'snapshot byte lenght: ' + snapshot?.byteLength);

      callback(undefined, snapshot);
    } catch (err) {
      this.log.error(this.cameraName, err as string);
      callback();
    }
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {

    const videoReturnPort = await FFmpegParameters.allocateUDPPort();
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const audioReturnPort = await FFmpegParameters.allocateUDPPort();
    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

    const sessionInfo: SessionInfo = {
      address: request.targetAddress,
      ipv6: request.addressVersion === 'ipv6',

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
    this.log.debug(this.cameraName, 'Starting session with id: ' + request.sessionID);

    const sessionInfo = this.pendingSessions.get(request.sessionID);

    if (!sessionInfo) {
      this.log.error(this.cameraName, 'Error finding session information.');
      callback(new Error('Error finding session information'));
    }

    this.log.debug(this.cameraName, 'VIDEOCONFIG: ' + JSON.stringify(this.videoConfig));

    try {
      const activeSession: ActiveSession = {};

      // get streams
      const videoParams = await FFmpegParameters.create({ type: 'video', debug: this.videoConfig.debug });
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
        audioParams = await FFmpegParameters.create({ type: 'audio', debug: this.videoConfig.debug });
        audioParams.setup(this.cameraConfig, request);
        audioParams.setRTPTarget(sessionInfo!, request);
      }

      const rtsp = is_rtsp_ready(this.device, this.cameraConfig, this.log);

      let streamData: StationStream | null = null;

      if (rtsp) {
        const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
        this.platform.log.debug(this.cameraName, 'RTSP URL: ' + url);
        videoParams.setInputSource(url as string);
        audioParams?.setInputSource(url as string);
      } else {

        const value = await this.localLivestreamManager.getLocalLivestream()
          .catch((err) => {
            throw ((this.cameraName + ' Unable to start the livestream: ' + err) as string);
          });

        streamData = value;

        videoParams.setInputSource('pipe:3');
        audioParams?.setInputSource('pipe:4');

      }

      const videoProcess = new FFmpeg(
        `[${this.cameraName}] [Video Process]`,
        audioParams ? [videoParams, audioParams] : [videoParams],
        this.platform.ffmpegLogger,
      );

      videoProcess.on('started', () => {
        callback();
      });

      videoProcess.on('error', (err) => {
        this.log.error(this.cameraName, 'Video process ended with error: ' + err);
        this.stopStream(request.sessionID);
      });

      videoProcess.on('exit', () => {
        this.log.info(this.cameraName, 'Video process ended');
        this.stopStream(request.sessionID);
      });

      activeSession.videoProcess = videoProcess;
      activeSession.videoProcess.start();

      if (activeSession.videoProcess && activeSession.videoProcess.stdio) {
        // stdio is defined and can be used

        if (streamData !== null) {
          streamData.videostream.pipe(activeSession.videoProcess.stdio[3] as Writable);
          streamData.audiostream.pipe(activeSession.videoProcess.stdio[4] as Writable);
        }
      }

      if (this.cameraConfig.talkback) {
        const talkbackParameters = await FFmpegParameters.create({ type: 'audio', debug: this.videoConfig.debug });
        await talkbackParameters.setTalkbackInput(sessionInfo!);
        activeSession.talkbackStream = new TalkbackStream(this.platform, this.device);
        activeSession.returnProcess = new FFmpeg(
          `[${this.cameraName}] [Talkback Process]`,
          [talkbackParameters],
          this.platform.ffmpegLogger,
        );
        activeSession.returnProcess.on('error', (err) => {
          this.log.error(this.cameraName, 'Talkback process ended with error: ' + err);
          this.stopStream(request.sessionID);
        });
        activeSession.returnProcess.on('exit', () => {
          this.log.info(this.cameraName, 'Talkback process ended');
          this.stopStream(request.sessionID);
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

  /**
   * Handles various types of streaming requests.
   *
   * This method delegates different types of streaming requests (like starting, reconfiguring, or stopping a stream)
   * to their respective handlers. It enhances code organization by segregating different request handling logics into
   * separate methods. This makes the code easier to read and maintain.
   *
   * @param {StreamingRequest} request - The streaming request to be handled.
   * @param {StreamRequestCallback} callback - The callback to be invoked after handling the request.
   */
  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    this.log.debug(this.cameraName, 'Receive Apple HK stream request' + JSON.stringify(request));
    switch (request.type) {
      case StreamRequestTypes.START:
        this.startStream(request, callback);
        break;
      case StreamRequestTypes.RECONFIGURE:
        callback();
        break;
      case StreamRequestTypes.STOP:
        this.stopStream(request.sessionID);
        callback();
        break;
    }
  }

  /**
   * Safely stops a specific resource associated with the streaming session.
   *
   * This method attempts to stop or clean up a given resource (like a stream or a socket) and handles any errors that
   * may occur in the process. It's a general-purpose utility method to ensure that all resources are closed properly
   * without causing unhandled exceptions. This improves the robustness of the resource management in streaming sessions.
   * 
   * @param {string} resourceName - A descriptive name of the resource for logging purposes.
   * @param {() => void} stopAction - A function encapsulating the logic to stop or clean up the resource.
   */
  private safelyStopResource(resourceName: string, stopAction: () => void): void {
    try {
      stopAction();
    } catch (err) {
      this.log.error(this.cameraName, `Error occurred terminating ${resourceName}: ${err}`);
    }
  }

  /**
   * Stops an ongoing streaming session.
   *
   * This method is responsible for stopping all processes and resources associated with a given streaming session.
   * It first checks for any pending sessions with the provided session ID and removes them if found.
   * Then, it proceeds to stop all active processes (video, audio, return processes) and resources (talkback stream, socket)
   * associated with the ongoing session. Each resource is stopped safely using the `safelyStopResource` method, which handles
   * any errors that may occur during the stopping process. If no session is found with the given ID, it logs that no session
   * needs to be stopped.
   * 
   * @param {string} sessionId - The unique identifier of the streaming session to be stopped.
   */
  public stopStream(sessionId: string): void {
    this.log.debug('Stopping session with id: ' + sessionId);

    const pendingSession = this.pendingSessions.get(sessionId);
    if (pendingSession) {
      this.pendingSessions.delete(sessionId);
    }

    const session = this.ongoingSessions.get(sessionId);
    if (session) {
      this.safelyStopResource('talkbackStream', () => session.talkbackStream?.stopTalkbackStream());
      this.safelyStopResource('returnAudio FFmpeg process', () => {
        session.returnProcess?.stdout?.unpipe();
        session.returnProcess?.stop();
      });
      this.safelyStopResource('video FFmpeg process', () => session.videoProcess?.stop());
      this.safelyStopResource('audio FFmpeg process', () => session.audioProcess?.stop());

      if (!is_rtsp_ready(this.device, this.cameraConfig, this.log)) {
        this.log.debug(this.cameraName, 'Streaming STOP! Stream!');
        this.safelyStopResource('Eufy Station livestream', () => this.localLivestreamManager.stopLocalLiveStream());
      }

      this.ongoingSessions.delete(sessionId);
      this.log.info(this.cameraName, 'Stopped video stream.');
    } else {
      this.log.debug(this.cameraName, 'No session to stop.');
    }
  }
}