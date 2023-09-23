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
import { Logger as TsLogger, ILogObj } from 'tslog';
import net from 'net';
import { is_rtsp_ready } from '../utils/utils';
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

  private platform: EufySecurityPlatform;
  private readonly log: TsLogger<ILogObj>;
  private camera: Camera;
  private cameraConfig: CameraConfig;
  private accessory: PlatformAccessory;

  private configuration?: CameraRecordingConfiguration;

  private forceStopTimeout?: NodeJS.Timeout;
  private closeReason?: number;
  private handlingStreamingRequest = false;

  private localLivestreamManager: LocalLivestreamManager;
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
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: Camera,
    cameraConfig: CameraConfig,
    livestreamManager: LocalLivestreamManager,
  ) {
    this.platform = platform;
    this.log = platform.log;
    this.accessory = accessory;
    this.camera = device;
    this.cameraConfig = cameraConfig;
    this.localLivestreamManager = livestreamManager;
  }

  public setController(controller: CameraController) {
    this.controller = controller;
  }

  public isRecording(): boolean {
    return this.handlingStreamingRequest;
  }

  async * handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket, any, unknown> {
    this.handlingStreamingRequest = true;
    this.log.info(this.camera.getName(), 'requesting recording for HomeKit Secure Video.');

    let cachedStreamId: number | undefined = undefined;

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

      const videoParams = await FFmpegParameters.forVideoRecording();
      const audioParams = await FFmpegParameters.forAudioRecording();

      const hsvConfig: VideoConfig = this.cameraConfig.hsvConfig ?? {};

      if (this.cameraConfig.videoConfig && this.cameraConfig.videoConfig.videoProcessor) {
        hsvConfig.videoProcessor = this.cameraConfig.videoConfig.videoProcessor;
      }

      videoParams.setupForRecording(hsvConfig, this.configuration!);
      audioParams.setupForRecording(hsvConfig, this.configuration!);

      const rtsp = is_rtsp_ready(this.camera, this.cameraConfig, this.log);

      if (rtsp) {
        const url = this.camera.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
        this.platform.log.debug(this.camera.getName(), 'RTSP URL: ' + url);
        videoParams.setInputSource(url as string);
        audioParams.setInputSource(url as string);
      } else {
        const streamData = await this.localLivestreamManager.getLocalLivestream().catch((err) => {
          throw err;
        });
        await videoParams.setInputStream(streamData.videostream);
        await audioParams.setInputStream(streamData.audiostream);
        cachedStreamId = streamData.id;
      }

      const ffmpeg = new FFmpeg(
        `[${this.camera.getName()}] [HSV Recording Process]`,
        audioEnabled ? [videoParams, audioParams] : videoParams,
        this.log,
      );

      this.session = await ffmpeg.startFragmentedMP4Session();

      let timer = this.cameraConfig.hsvRecordingDuration ?? MAX_RECORDING_MINUTES * 60;
      if (this.platform.config.CameraMaxLivestreamDuration < timer) {
        timer = this.platform.config.CameraMaxLivestreamDuration;
      }

      if (timer > 0) {
        this.forceStopTimeout = setTimeout(() => {
          this.log.warn(
            this.camera.getName(),
            `The recording process has been running for ${timer} seconds and is now being forced closed!`,
          );

          this.accessory
            .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected)
            .updateValue(false);
        }, timer * 1000);
      }

      for await (const box of this.session.generator) {

        if (!this.handlingStreamingRequest) {
          this.log.debug(this.camera.getName(), 'Recording was ended prematurely.');
          break;
        }

        const { header, type, data } = box;

        pending.push(header, data);

        const motionDetected = this.accessory
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
            this.log.debug(this.camera.getName(), 'Ending recording session due to motion stopped!');
            break;
          }
        }
      }
    } catch (error) {
      if (!this.handlingStreamingRequest && this.closeReason && this.closeReason === HDSProtocolSpecificErrorReason.CANCELLED) {
        this.log.debug(this.camera.getName(),
          'Recording encountered an error but that is expected, as the recording was canceled beforehand. Error: ' + error);
      } else {
        this.log.error(this.camera.getName(), 'Error while recording: ' + error);
      }
    } finally {
      if (this.closeReason &&
        this.closeReason !== HDSProtocolSpecificErrorReason.NORMAL && this.closeReason !== HDSProtocolSpecificErrorReason.CANCELLED) {

        this.log.warn(
          this.camera.getName(),
          `The recording process was aborted by HSV with reason "${HKSVQuitReason[this.closeReason]}"`,
        );
      }
      if (this.closeReason && this.closeReason === HDSProtocolSpecificErrorReason.CANCELLED) {

        this.log.debug(
          this.camera.getName(),
          'The recording process was canceled by the HomeKit Controller."',
        );
      }
      if (filebuffer.length > 0) {
        this.log.debug(this.camera.getName(), 'Recording completed (HSV). Send ' + filebuffer.length + ' bytes.');
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

      if (cachedStreamId) {
        this.localLivestreamManager.stopProxyStream(cachedStreamId);
      }
    }
  }

  updateRecordingActive(active: boolean): void {
    //this.log.debug(`Recording: ${active}`, this.accessory.displayName);
  }

  updateRecordingConfiguration(configuration: CameraRecordingConfiguration | undefined): void {
    this.configuration = configuration;
  }

  closeRecordingStream(streamId: number, reason: HDSProtocolSpecificErrorReason | undefined): void {
    this.log.info(this.camera.getName(), 'Closing recording process');

    if (this.session) {
      this.log.debug(this.camera.getName(), 'Stopping recording session.');
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