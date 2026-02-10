 
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

  private resetMotionSensor(): void {
    const motionDetected = this.accessory
      .getService(SERV.MotionSensor)?.getCharacteristic(CHAR.MotionDetected).value;
    if (motionDetected) {
      this.accessory
        .getService(SERV.MotionSensor)?.getCharacteristic(CHAR.MotionDetected)
        .updateValue(false);
    }
  }

  private clearForceStopTimeout(): void {
    if (this.forceStopTimeout) {
      clearTimeout(this.forceStopTimeout);
      this.forceStopTimeout = undefined;
    }
  }

  private async configureInputSource(
    videoParams: FFmpegParameters,
    audioParams: FFmpegParameters,
  ): Promise<void> {
    if (is_rtsp_ready(this.camera, this.cameraConfig)) {
      const url = this.camera.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) as string;
      log.debug(this.camera.getName(), 'RTSP URL: ' + url);
      videoParams.setInputSource(url);
      audioParams.setInputSource(url);
    } else {
      const streamData = await this.localLivestreamManager.getLocalLivestream();
      await videoParams.setInputStream(streamData.videostream);
      await audioParams.setInputStream(streamData.audiostream);
    }
  }

  async * handleRecordingStreamRequest(): AsyncGenerator<RecordingPacket, any, unknown> {
    this.handlingStreamingRequest = true;
    this.closeReason = undefined;
    log.info(this.camera.getName(), 'requesting recording for HomeKit Secure Video.');

    let totalBytes = 0;
    let fragmentCount = 0;

    try {
      if (!this.configuration) {
        log.error(this.camera.getName(), 'No recording configuration available. Aborting.');
        yield { data: Buffer.alloc(0), isLast: true };
        return;
      }

      const audioEnabled = this.controller?.recordingManagement?.recordingManagementService.getCharacteristic(CHAR.RecordingAudioActive).value;
      if (audioEnabled) {
        log.debug(this.camera.getName(), 'HKSV and plugin are set to record audio.');
      } else {
        log.debug(this.camera.getName(), 'HKSV and plugin are set to omit audio recording.');
      }

      const videoParams = await FFmpegParameters.forVideoRecording();
      const audioParams = await FFmpegParameters.forAudioRecording();

      const videoConfig: VideoConfig = this.cameraConfig.videoConfig ?? {};

      videoParams.setupForRecording(videoConfig, this.configuration);
      audioParams.setupForRecording(videoConfig, this.configuration);

      await this.configureInputSource(videoParams, audioParams);

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

          this.resetMotionSensor();
        }, timer * 1000);
      }

      // Properly handle fragmented MP4 structure for HKSV:
      // 1. Initialization segment: accumulate ftyp + moov, yield once
      // 2. Media fragments: yield each moof + mdat pair
      let isInitializationSegment = true;
      let initPending: Buffer[] = [];
      let moofBuffer: Buffer | null = null;

      for await (const box of this.session.generator) {

        if (!this.handlingStreamingRequest) {
          log.debug(this.camera.getName(), 'Recording was ended prematurely.');
          break;
        }

        const { header, type, data } = box;

        if (isInitializationSegment) {
          // Accumulate ftyp + moov into initialization segment
          initPending.push(header, data);

          if (type === 'moov') {
            const fragment = Buffer.concat(initPending);
            totalBytes += fragment.length;
            initPending = [];
            isInitializationSegment = false;

            log.debug(this.camera.getName(), `HKSV: Sending initialization segment, size: ${fragment.length}`);

            yield {
              data: fragment,
              isLast: false,
            };
          }
        } else {
          // Media fragments: pair moof + mdat
          if (type === 'moof') {
            moofBuffer = Buffer.concat([header, data]);
          } else if (type === 'mdat' && moofBuffer) {
            const fragment = Buffer.concat([moofBuffer, header, data]);
            moofBuffer = null;
            fragmentCount++;
            totalBytes += fragment.length;

            log.debug(this.camera.getName(), `HKSV: Fragment #${fragmentCount}, size: ${fragment.length}`);

            yield {
              data: fragment,
              isLast: false,
            };

            // Check if motion has stopped after yielding the fragment
            const motionDetected = this.accessory
              .getService(SERV.MotionSensor)?.getCharacteristic(CHAR.MotionDetected).value;
            if (!motionDetected) {
              log.debug(this.camera.getName(), 'Ending recording session due to motion stopped.');
              break;
            }
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
      if (totalBytes > 0) {
        log.debug(this.camera.getName(), `Recording completed (HSV). Sent ${fragmentCount} fragments, ${totalBytes} bytes total.`);
      }

      this.clearForceStopTimeout();
      this.resetMotionSensor();
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

    this.clearForceStopTimeout();
    this.resetMotionSensor();

    this.closeReason = reason;
    this.handlingStreamingRequest = false;
  }

  acknowledgeStream(streamId) {
    log.debug('end of recording acknowledged!');
    this.closeRecordingStream(streamId, undefined);
  }
}