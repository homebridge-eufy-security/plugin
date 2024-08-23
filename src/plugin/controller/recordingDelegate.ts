/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChildProcessWithoutNullStreams } from 'child_process';
import { Camera, PropertyName } from 'eufy-security-client';
import {
  CameraController,
  CameraRecordingConfiguration,
  CameraRecordingDelegate,
  HDSProtocolSpecificErrorReason,
  PlatformAccessory,
  RecordingPacket,
} from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { CameraConfig, VideoConfig } from '../utils/configTypes';
import { FFmpeg, FFmpegParameters } from '../utils/ffmpeg';
import net from 'net';
import { CHAR, SERV, is_rtsp_ready, log } from '../utils/utils';
import { LocalLivestreamManager } from './LocalLivestreamManager';

const MAX_RECORDING_MINUTES = 1; // should never be used

const HKSVQuitReason = [
  'Normal',
  'Not allowed',
  'Busy',
  'Cancelled',
  'Unsupported',
  'Unexpected Failure',
  'Timeout',
  'Bad data',
  'Protocol error',
  'Invalid Configuration',
];

export class RecordingDelegate implements CameraRecordingDelegate {

  private configuration?: CameraRecordingConfiguration;

  private forceStopTimeout?: NodeJS.Timeout;
  private closeReason?: number;
  private handlingStreamingRequest = false;

  private controller?: CameraController;

  private session?: {
    socket: net.Socket;
    process?: ChildProcessWithoutNullStreams | undefined;
    generator: AsyncGenerator<{
      header: Buffer;
      length: number;
      type: string;
      data: Buffer;
    }, any, unknown>;
  };

  constructor(
    private platform: EufySecurityPlatform,
    private accessory: PlatformAccessory,
    private camera: Camera,
    private cameraConfig: CameraConfig,
    private localLivestreamManager: LocalLivestreamManager,
  ) {

  }

  public setController(controller: CameraController) {
    this.controller = controller;
  }

  public isRecording(): boolean {
    return this.handlingStreamingRequest;
  }

  async * handleRecordingStreamRequest(): AsyncGenerator<RecordingPacket, any, unknown> {
    this.handlingStreamingRequest = true;
    log.info(this.camera.getName(), 'requesting recording for HomeKit Secure Video.');

    let pending: Buffer[] = [];
    let filebuffer = Buffer.alloc(0);

    try {
      const audioEnabled = this.controller?.recordingManagement?.recordingManagementService.getCharacteristic(CHAR.RecordingAudioActive).value;
      if (audioEnabled) {
        log.debug('HKSV and plugin are set to record audio.');
      } else {
        log.debug('HKSV and plugin are set to omit audio recording.');
      }

      const videoParams = await FFmpegParameters.forVideoRecording();
      const audioParams = await FFmpegParameters.forAudioRecording();

      const videoConfig: VideoConfig = this.cameraConfig.videoConfig ?? {};

      if (this.cameraConfig.videoConfig && this.cameraConfig.videoConfig.videoProcessor) {
        videoConfig.videoProcessor = this.cameraConfig.videoConfig.videoProcessor;
      }

      videoParams.setupForRecording(videoConfig, this.configuration!);
      audioParams.setupForRecording(videoConfig, this.configuration!);

      const rtsp = is_rtsp_ready(this.camera, this.cameraConfig);

      if (rtsp) {
        const url = this.camera.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
        log.debug(this.camera.getName(), 'RTSP URL: ' + url);
        videoParams.setInputSource(url as string);
        audioParams.setInputSource(url as string);
      } else {
        const streamData = await this.localLivestreamManager.getLocalLivestream().catch((error) => {
          throw error;
        });
        await videoParams.setInputStream(streamData.videostream);
        await audioParams.setInputStream(streamData.audiostream);
      }

      const ffmpeg = new FFmpeg(
        `[${this.camera.getName()}] [HSV Recording Process]`,
        audioEnabled ? [videoParams, audioParams] : videoParams,
      );

      this.session = await ffmpeg.startFragmentedMP4Session();

      let timer = this.cameraConfig.hsvRecordingDuration ?? MAX_RECORDING_MINUTES * 60;
      if (this.platform.config.CameraMaxLivestreamDuration < timer) {
        timer = this.platform.config.CameraMaxLivestreamDuration;
      }

      if (timer > 0) {
        this.forceStopTimeout = setTimeout(() => {
          log.warn(
            this.camera.getName(),
            `The recording process has been running for ${timer} seconds and is now being forced closed!`,
          );

          this.accessory
            .getService(SERV.MotionSensor)?.getCharacteristic(CHAR.MotionDetected)
            .updateValue(false);
        }, timer * 1000);
      }

      for await (const box of this.session.generator) {

        if (!this.handlingStreamingRequest) {
          log.debug(this.camera.getName(), 'Recording was ended prematurely.');
          break;
        }

        const { header, type, data } = box;

        pending.push(header, data);

        const motionDetected = this.accessory
          .getService(SERV.MotionSensor)?.getCharacteristic(CHAR.MotionDetected).value;

        if (type === 'moov' || type === 'mdat') {
          const fragment = Buffer.concat(pending);

          filebuffer = Buffer.concat([filebuffer, Buffer.concat(pending)]);
          pending = [];

          yield {
            data: fragment,
            isLast: !motionDetected,
          };

          if (!motionDetected) {
            log.debug(this.camera.getName(), 'Ending recording session due to motion stopped!');
            break;
          }
        }
      }
    } catch (error) {
      if (!this.handlingStreamingRequest && this.closeReason && this.closeReason === HDSProtocolSpecificErrorReason.CANCELLED) {
        log.debug(this.camera.getName(),
          'Recording encountered an error but that is expected, as the recording was canceled beforehand. Error: ' + error);
      } else {
        log.error(this.camera.getName(), 'Error while recording: ' + error);
      }
    } finally {
      if (this.closeReason &&
        this.closeReason !== HDSProtocolSpecificErrorReason.NORMAL && this.closeReason !== HDSProtocolSpecificErrorReason.CANCELLED) {

        log.warn(
          this.camera.getName(),
          `The recording process was aborted by HSV with reason "${HKSVQuitReason[this.closeReason]}"`,
        );
      }
      if (this.closeReason && this.closeReason === HDSProtocolSpecificErrorReason.CANCELLED) {

        log.debug(
          this.camera.getName(),
          'The recording process was canceled by the HomeKit Controller."',
        );
      }
      if (filebuffer.length > 0) {
        log.debug(this.camera.getName(), 'Recording completed (HSV). Send ' + filebuffer.length + ' bytes.');
      }

      if (this.forceStopTimeout) {
        clearTimeout(this.forceStopTimeout);
        this.forceStopTimeout = undefined;
      }

      // check whether motion is still in progress
      const motionDetected = this.accessory
        .getService(SERV.MotionSensor)?.getCharacteristic(CHAR.MotionDetected).value;
      if (motionDetected) {
        this.accessory
          .getService(SERV.MotionSensor)?.getCharacteristic(CHAR.MotionDetected)
          .updateValue(false);
      }

      this.localLivestreamManager.stopLocalLiveStream();
    }
  }

  updateRecordingActive(active: boolean): void {
    log.debug(`Recording: ${active}`, this.accessory.displayName);
  }

  updateRecordingConfiguration(configuration: CameraRecordingConfiguration | undefined): void {
    this.configuration = configuration;
  }

  closeRecordingStream(streamId: number, reason: HDSProtocolSpecificErrorReason | undefined): void {
    log.info(this.camera.getName(), 'Closing recording process');

    if (this.session) {
      log.debug(this.camera.getName(), 'Stopping recording session.');
      this.session.socket?.destroy();
      this.session.process?.kill('SIGKILL');
      this.session = undefined;
    } else {
      log.warn('Recording session could not be closed gracefully.');
    }

    if (this.forceStopTimeout) {
      clearTimeout(this.forceStopTimeout);
      this.forceStopTimeout = undefined;
    }

    // check whether motion is still in progress
    const motionDetected = this.accessory
      .getService(SERV.MotionSensor)?.getCharacteristic(CHAR.MotionDetected).value;
    if (motionDetected) {
      this.accessory
        .getService(SERV.MotionSensor)?.getCharacteristic(CHAR.MotionDetected)
        .updateValue(false);
    }

    this.closeReason = reason;
    this.handlingStreamingRequest = false;
  }

  acknowledgeStream(streamId) {
    log.debug('end of recording acknowledged!');
    this.closeRecordingStream(streamId, undefined);
  }
}