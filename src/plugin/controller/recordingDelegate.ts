/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { CameraConfig } from '../utils/configTypes';
import { FFmpegRecord } from '../utils/ffmpeg-record';
import { FFmpegParameters } from '../utils/ffmpeg-params';
import { is_rtsp_ready, log } from '../utils/utils';
import { LocalLivestreamManager, StationStream } from './LocalLivestreamManager';
import { StreamingDelegate } from './streamingDelegate';
import { Writable } from 'stream';

const MAX_RECORDING_MINUTES = 3;

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

  private platform: EufySecurityPlatform;
  private camera: Camera;
  private cameraName: string;
  private cameraConfig: CameraConfig;
  private localLivestreamManager: LocalLivestreamManager;

  private controller?: CameraController;

  private session?: FFmpegRecord;

  constructor(
    private streamingDelegate: StreamingDelegate,
    private accessory: PlatformAccessory,
  ) {
    this.platform = this.streamingDelegate.platform;
    this.camera = this.streamingDelegate.device;
    this.cameraName = this.streamingDelegate.cameraName;
    this.cameraConfig = this.streamingDelegate.cameraConfig;
    this.localLivestreamManager = this.streamingDelegate.getLivestreamManager();
  }

  public setController(controller: CameraController) {
    this.controller = controller;
  }

  public isRecording(): boolean {
    return this.handlingStreamingRequest;
  }

  async * handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    this.handlingStreamingRequest = true;
    log.info(`${this.cameraName} requesting recording for HomeKit Secure Video. ID: ${streamId}`);

    try {
      // eslint-disable-next-line max-len
      const audioEnabled = this.controller?.recordingManagement?.recordingManagementService.getCharacteristic(this.platform.Characteristic.RecordingAudioActive).value;
      if (audioEnabled) {
        log.debug('HKSV and plugin are set to record audio.');
      } else {
        log.debug('HKSV and plugin are set to omit audio recording.');
      }

      const videoParams = await FFmpegParameters.create({ type: 'videoRecording', debug: true });
      const audioParams = await FFmpegParameters.create({ type: 'audioRecording', debug: true });

      videoParams.setupForRecording(this.cameraConfig.videoConfig || {}, this.configuration!);
      audioParams.setupForRecording(this.cameraConfig.videoConfig || {}, this.configuration!);

      const rtsp = is_rtsp_ready(this.camera, this.cameraConfig);

      let streamData: StationStream | null = null;

      if (rtsp) {
        const url = this.camera.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
        log.debug(this.cameraName, 'RTSP URL: ' + url);
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

      log.debug(this.cameraName, 'FFMPEG Process definition!');

      this.session = new FFmpegRecord(
        `[${this.cameraName}] [HSV Recording Process]`,
        audioEnabled ? [videoParams, audioParams] : [videoParams],
      );

      log.debug(this.cameraName, 'startFragmentedMP4Session Start!');
      await this.session.start();
      log.debug(this.cameraName, 'startFragmentedMP4Session Finish!');

      if (this.session.process && this.session.process.stdio) {
        // stdio is defined and can be used
        log.debug(this.cameraName, 'stdio is defined and can be used!');

        if (streamData !== null) {
          log.debug(this.cameraName, 'Stream Data!');
          streamData.videostream.pipe(this.session.process.stdio[3] as Writable);
          if (audioEnabled) {
            streamData.audiostream.pipe(this.session.process.stdio[4] as Writable);
          }
        }
      }

      let timer = MAX_RECORDING_MINUTES * 60;
      if (this.platform.config.CameraMaxLivestreamDuration < timer) {
        timer = this.platform.config.CameraMaxLivestreamDuration;
      }

      if (timer > 0) {
        this.forceStopTimeout = setTimeout(() => {
          log.warn(
            this.cameraName,
            `The recording process has been running for ${timer} seconds and is now being forced closed!`,
          );

          this.accessory
            .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected)
            .updateValue(false);
        }, timer * 1000);
      }

      let isMotionActive = true;
      setTimeout(() => {
        isMotionActive = false;
        log.debug(this.cameraName, 'Ending recording session due to motion stopped!');
      }, 60 * 1000); // Set the flag to false after 15 seconds


      log.debug(this.cameraName, 'Generator Start!');

      for await (const segment of this.session.segmentGenerator()) {

        if (!this.isRecording()) {
          log.debug(this.cameraName, 'Recording was ended prematurely.');
          break;
        }

        if (!segment) {
          continue;
        }
        log.debug(`${this.cameraName} Yeah a good segment!`);

        // const motionDetected = this.accessory
        //   .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected).value;

        yield {
          data: segment,
          isLast: !isMotionActive,
        };

        if (!isMotionActive) {
          log.debug(this.cameraName, 'Ending recording session due to motion stopped!');
          break;
        }

      }
    } catch (error) {
      if (!this.handlingStreamingRequest && this.closeReason && this.closeReason === HDSProtocolSpecificErrorReason.CANCELLED) {
        log.debug(this.cameraName,
          'Recording encountered an error but that is expected, as the recording was canceled beforehand. Error: ' + error);
      } else {
        log.error(this.cameraName, 'Error while recording: ' + error);
      }
    } finally {
      if (this.closeReason &&
        this.closeReason !== HDSProtocolSpecificErrorReason.NORMAL && this.closeReason !== HDSProtocolSpecificErrorReason.CANCELLED) {

        log.warn(
          this.cameraName,
          `The recording process was aborted by HSV with reason "${HKSVQuitReason[this.closeReason]}"`,
        );
      }
      if (this.closeReason && this.closeReason === HDSProtocolSpecificErrorReason.CANCELLED) {

        log.debug(
          this.cameraName,
          'The recording process was canceled by the HomeKit Controller."',
        );
      }

      if (this.forceStopTimeout) {
        clearTimeout(this.forceStopTimeout);
        this.forceStopTimeout = undefined;
      }

      // check whether motion is still in progress
      const motionDetected = this.accessory
        .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected).value;
      if (motionDetected) {
        this.accessory
          .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected)
          .updateValue(false);
      }

      log.debug(this.cameraName, 'Streaming STOP! Recording!');
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
    log.info(this.cameraName, 'Closing recording process');

    if (this.session) {
      log.debug(this.cameraName, 'Stopping recording session.');
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
      .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected).value;
    if (motionDetected) {
      this.accessory
        .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected)
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