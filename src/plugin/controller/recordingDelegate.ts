/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChildProcessWithoutNullStreams } from 'child_process';
import { Camera } from 'eufy-security-client';
import {
  CameraRecordingConfiguration,
  CameraRecordingDelegate,
  HDSProtocolSpecificErrorReason,
  PlatformAccessory,
  RecordingPacket,
} from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { CameraConfig } from '../utils/configTypes';
import { FFmpeg, FFmpegParameters } from '../utils/ffmpeg';
import { Logger } from '../utils/logger';
import net from 'net';

const MAX_RECORDING_MINUTES = 3;

export class RecordingDelegate implements CameraRecordingDelegate {

  private platform: EufySecurityPlatform;
  private log: Logger;
  private camera: Camera;
  private cameraConfig: CameraConfig;
  private accessory: PlatformAccessory;

  private configuration?: CameraRecordingConfiguration;

  private forceStopTimeout?: NodeJS.Timeout;
  private closeReason?: number;
  private handlingStreamingRequest = false;

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

  constructor(platform: EufySecurityPlatform, accessory: PlatformAccessory, device: Camera, cameraConfig: CameraConfig, log: Logger) {
    this.platform = platform;
    this.log = log;
    this.accessory = accessory;
    this.camera = device;
    this.cameraConfig = cameraConfig;
  }

  async * handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket, any, unknown> {
    this.handlingStreamingRequest = true;
    this.log.debug(this.camera.getName(), 'requesting recording for HomeKit Secure Video.');

    const videoParams = await FFmpegParameters.forVideoRecording();
    const audioParams = await FFmpegParameters.forAudioRecording();

    const ffmpeg = new FFmpeg(
      `[${this.camera.getName()}] [HSV Recording Process]`,
      this.cameraConfig.videoConfig?.audio ? [videoParams, audioParams] : videoParams,
      this.log,
    );

    this.session = await ffmpeg.startFragmentedMP4Session();

    const timer = MAX_RECORDING_MINUTES;

    if (timer > 0) {
      this.forceStopTimeout = setTimeout(() => {
        this.log.warn(
          this.camera.getName(),
          `The recording process has been running for ${timer} minutes and is now being forced closed!`,
        );

        this.accessory
          .getService(this.platform.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected)
          .updateValue(false);
      }, timer * 60 * 1000);
    }

    let pending: Buffer[] = [];
    let filebuffer = Buffer.alloc(0);


    try {
      for await (const box of this.session.generator) {
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
      this.log.error(this.camera.getName(), 'Error while recording: ' + error);
    } finally {
      if (this.closeReason && this.closeReason !== HDSProtocolSpecificErrorReason.NORMAL) {
        this.log.warn(
          this.camera.getName(),
          `The recording process was aborted by HSV with reason "${this.closeReason}"`,
        );
      } else if (filebuffer.length > 0) {
        this.log.debug(this.camera.getName(), 'Recording completed (HSV)');
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
      this.session.socket?.destroy();
      this.session.process?.kill('SIGKILL');
      this.session = undefined;
    }

    if (this.forceStopTimeout) {
      clearTimeout(this.forceStopTimeout);
      this.forceStopTimeout = undefined;
    }

    this.closeReason = reason;
    this.handlingStreamingRequest = false;
  }

  acknowledgeStream(streamId) {
    this.closeRecordingStream(streamId, undefined);
  }
}