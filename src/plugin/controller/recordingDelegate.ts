/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChildProcessWithoutNullStreams } from 'child_process';
import { Camera, PropertyName } from 'eufy-security-client';
import {
  API,
  CameraController,
  CameraRecordingConfiguration,
  CameraRecordingDelegate,
  HAP,
  HDSProtocolSpecificErrorReason,
  RecordingPacket,
} from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { VideoConfig } from '../utils/configTypes';
import { Logger as TsLogger, ILogObj } from 'tslog';
import net from 'net';
import { is_rtsp_ready } from '../utils/utils';
import { StationStream, LocalLivestreamManager } from './LocalLivestreamManager';
import { CameraAccessory } from '../accessories/CameraAccessory';

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

  private readonly platform: EufySecurityPlatform = this.camera.platform;
  private readonly device: Camera = this.camera.device;
  private readonly hap: HAP = this.platform.api.hap;
  private readonly api: API = this.platform.api;
  private readonly log: TsLogger<ILogObj> = this.platform.log;
  private readonly cameraName: string = this.device.getName();
  private localLivestreamManager: LocalLivestreamManager = this.camera.streamingDelegate!.getLivestreamManager();

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
    private readonly camera: CameraAccessory,
  ) { }

  public setController(controller: CameraController) {
    this.controller = controller;
  }

  public isRecording(): boolean {
    return this.handlingStreamingRequest;
  }

  public async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    this.handlingStreamingRequest = true;
    this.log.info(this.cameraName, 'requesting recording for HomeKit Secure Video.');

    let cachedStream: StationStream | undefined = undefined;

    let pending: Buffer[] = [];
    let filebuffer = Buffer.alloc(0);

    try {
      // eslint-disable-next-line max-len
      const audioEnabled = this.controller?.recordingManagement?.recordingManagementService.getCharacteristic(this.platform.Characteristic.RecordingAudioActive).value;
      if (audioEnabled) {
        this.log.debug('HKSV and plugin are set to record audio.');
      } else {
        this.log.debug('HKSV and plugin are set to omit audio recording.');
      }

      const hsvConfig: VideoConfig = this.camera.cameraConfig.hsvConfig ?? {};

      if (this.camera.cameraConfig.videoConfig && this.camera.cameraConfig.videoConfig.videoProcessor) {
        hsvConfig.videoProcessor = this.camera.cameraConfig.videoConfig.videoProcessor;
      }

      const rtsp = is_rtsp_ready(this.device, this.camera.cameraConfig, this.log);

      if (rtsp) {
        const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
        this.platform.log.debug(this.cameraName, 'RTSP URL: ' + url);

      } else {
        this.log.debug(this.cameraName + ' Piping the livestream');

        cachedStream = await this.localLivestreamManager.getLocalLivestream()
          .catch((err) => {
            throw err;
          });

        this.log.debug(this.cameraName + ' Got result for livestream');


      }

      // const ffmpeg = new FFmpeg(
      //   `[${this.cameraName}] [HSV Recording Process]`,
      //   audioEnabled ? [videoParams, audioParams] : [videoParams],
      //   this.platform.ffmpegLogger,
      // );

      // ffmpeg.on('started', () => { });

      // ffmpeg.on('error', (err) => {
      //   this.log.error(this.cameraName, ' [HSV Recording Process] ended with error: ' + err);
      // });

      // this.session = await ffmpeg.startFragmentedMP4Session();

      let timer = this.camera.cameraConfig.hsvRecordingDuration ?? MAX_RECORDING_MINUTES * 60;
      if (this.platform.config.CameraMaxLivestreamDuration < timer) {
        timer = this.platform.config.CameraMaxLivestreamDuration;
      }

      if (timer > 0) {
        this.forceStopTimeout = setTimeout(() => {
          this.log.warn(
            this.cameraName,
            `The recording process has been running for ${timer} seconds and is now being forced closed!`,
          );

          this.camera.accessory
            .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected)
            .updateValue(false);
        }, timer * 1000);
      }

      for await (const box of this.session!.generator) {

        if (!this.handlingStreamingRequest) {
          this.log.debug(this.cameraName, 'Recording was ended prematurely.');
          break;
        }

        const { header, type, data } = box;

        pending.push(header, data);

        const motionDetected = this.camera.accessory
          .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected).value;

        if (type === 'moov' || type === 'mdat') {
          const fragment = Buffer.concat(pending);

          filebuffer = Buffer.concat([filebuffer, Buffer.concat(pending)]);
          pending = [];

          yield {
            data: fragment,
            isLast: !motionDetected,
          };

          if (!motionDetected) {
            this.log.debug(this.cameraName, 'Ending recording session due to motion stopped!');
            break;
          }
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
      if (filebuffer.length > 0) {
        this.log.debug(this.cameraName, 'Recording completed (HSV). Send ' + filebuffer.length + ' bytes.');
      }

      if (this.forceStopTimeout) {
        clearTimeout(this.forceStopTimeout);
        this.forceStopTimeout = undefined;
      }

      // check whether motion is still in progress
      const motionDetected = this.camera.accessory
        .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected).value;
      if (motionDetected) {
        this.camera.accessory
          .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected)
          .updateValue(false);
      }

      if (cachedStream) {
        this.localLivestreamManager.stopLocalLiveStream();
      }
    }
  }

  updateRecordingActive(active: boolean): void {
    this.log.debug(this.cameraName, `Recording: ${active}`);
  }

  updateRecordingConfiguration(configuration: CameraRecordingConfiguration | undefined): void {
    this.configuration = configuration;
  }

  closeRecordingStream(streamId: number, reason: HDSProtocolSpecificErrorReason | undefined): void {
    this.log.info(this.cameraName, 'Closing recording process');

    if (this.session) {
      this.log.debug(this.cameraName, 'Stopping recording session.');
      this.session.socket?.destroy();
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
    const motionDetected = this.camera.accessory
      .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected).value;
    if (motionDetected) {
      this.camera.accessory
        .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected)
        .updateValue(false);
    }

    this.closeReason = reason;
    this.handlingStreamingRequest = false;
  }

  acknowledgeStream(streamId) {
    this.log.debug(this.cameraName, 'end of recording acknowledged!');
    this.closeRecordingStream(streamId, undefined);
  }
}