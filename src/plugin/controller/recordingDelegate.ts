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
import { Logger as TsLogger, ILogObj } from 'tslog';
import { is_rtsp_ready } from '../utils/utils';
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

  private platform: EufySecurityPlatform = this.streamingDelegate.platform;
  private camera: Camera = this.streamingDelegate.device;
  private cameraName: string = this.streamingDelegate.cameraName;
  private cameraConfig: CameraConfig = this.streamingDelegate.cameraConfig;
  private localLivestreamManager: LocalLivestreamManager = this.streamingDelegate.getLivestreamManager();
  private log: TsLogger<ILogObj> = this.platform.log;

  private controller?: CameraController;

  private session?: FFmpegRecord;

  constructor(
    private streamingDelegate: StreamingDelegate,
    private accessory: PlatformAccessory,
  ) { }

  public setController(controller: CameraController) {
    this.controller = controller;
  }

  public isRecording(): boolean {
    return this.handlingStreamingRequest;
  }

  async * handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    this.handlingStreamingRequest = true;
    this.log.info(`${this.cameraName} requesting recording for HomeKit Secure Video. ID: ${streamId}`);

    try {
      // eslint-disable-next-line max-len
      const audioEnabled = this.controller?.recordingManagement?.recordingManagementService.getCharacteristic(this.platform.Characteristic.RecordingAudioActive).value;
      if (audioEnabled) {
        this.log.debug('HKSV and plugin are set to record audio.');
      } else {
        this.log.debug('HKSV and plugin are set to omit audio recording.');
      }

      const videoParams = await FFmpegParameters.create({ type: 'videoRecording', debug: true });
      const audioParams = await FFmpegParameters.create({ type: 'audioRecording', debug: true });

      videoParams.setupForRecording(this.cameraConfig.videoConfig || {}, this.configuration!);
      audioParams.setupForRecording(this.cameraConfig.videoConfig || {}, this.configuration!);

      const rtsp = is_rtsp_ready(this.camera, this.cameraConfig, this.log);

      let streamData: StationStream | null = null;

      if (rtsp) {
        const url = this.camera.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
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

      this.log.debug(this.cameraName, 'FFMPEG Process definition!');

      this.session = new FFmpegRecord(
        `[${this.cameraName}] [HSV Recording Process]`,
        audioEnabled ? [videoParams, audioParams] : [videoParams],
        this.platform.ffmpegLogger,
      );

      this.log.debug(this.cameraName, 'startFragmentedMP4Session Start!');
      await this.session.start();
      this.log.debug(this.cameraName, 'startFragmentedMP4Session Finish!');

      if (this.session.process && this.session.process.stdio) {
        // stdio is defined and can be used
        this.log.debug(this.cameraName, 'stdio is defined and can be used!');

        if (streamData !== null) {
          this.log.debug(this.cameraName, 'Stream Data!');
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
          this.log.warn(
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
        this.log.debug(this.cameraName, 'Ending recording session due to motion stopped!');
      }, 60 * 1000); // Set the flag to false after 15 seconds


      this.log.debug(this.cameraName, 'Generator Start!');

      for await (const segment of this.session.segmentGenerator()) {

        if (!this.isRecording()) {
          this.log.debug(this.cameraName, 'Recording was ended prematurely.');
          break;
        }

        if (!segment) {
          continue;
        }
        this.log.debug(`${this.cameraName} Yeah a good segment!`);

        // const motionDetected = this.accessory
        //   .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected).value;

        yield {
          data: segment,
          isLast: !isMotionActive,
        };

        if (!isMotionActive) {
          this.log.debug(this.cameraName, 'Ending recording session due to motion stopped!');
          break;
        }

      }
    } catch (error) {
      if (!this.handlingStreamingRequest && this.closeReason && this.closeReason === HDSProtocolSpecificErrorReason.CANCELLED) {
        this.log.debug(this.cameraName,
          'Recording encountered an error but that is expected, as the recording was canceled beforehand. Error: ' + error);
      } else {
        this.log.error(this.cameraName, 'Error while recording: ' + error);
      }
    } finally {
      if (this.closeReason &&
        this.closeReason !== HDSProtocolSpecificErrorReason.NORMAL && this.closeReason !== HDSProtocolSpecificErrorReason.CANCELLED) {

        this.log.warn(
          this.cameraName,
          `The recording process was aborted by HSV with reason "${HKSVQuitReason[this.closeReason]}"`,
        );
      }
      if (this.closeReason && this.closeReason === HDSProtocolSpecificErrorReason.CANCELLED) {

        this.log.debug(
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

      this.log.debug(this.cameraName, 'Streaming STOP! Recording!');
      this.localLivestreamManager.stopLocalLiveStream();
    }
  }

  updateRecordingActive(active: boolean): void {
    this.log.debug(`Recording: ${active}`, this.accessory.displayName);
  }

  updateRecordingConfiguration(configuration: CameraRecordingConfiguration | undefined): void {
    this.configuration = configuration;
  }

  closeRecordingStream(streamId: number, reason: HDSProtocolSpecificErrorReason | undefined): void {
    this.log.info(this.cameraName, 'Closing recording process');

    if (this.session) {
      this.log.debug(this.cameraName, 'Stopping recording session.');
      this.session.process?.kill('SIGKILL');
      this.session = undefined;
    } else {
      this.log.warn('Recording session could not be closed gracefully.');
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
    this.log.debug('end of recording acknowledged!');
    this.closeRecordingStream(streamId, undefined);
  }
}