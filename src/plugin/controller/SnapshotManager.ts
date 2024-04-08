import { EventEmitter, Readable } from 'stream';

import { Camera, Device, DeviceEvents, Picture, PropertyName } from 'eufy-security-client';
import ffmpegPath from 'ffmpeg-for-homebridge';

import { CameraConfig } from '../utils/configTypes';
import { EufySecurityPlatform } from '../platform';
import { LocalLivestreamManager } from './LocalLivestreamManager';

import { is_rtsp_ready } from '../utils/utils';
import { SnapshotRequest } from 'homebridge';
import { FFmpeg, FFmpegParameters } from '../utils/ffmpeg';
import * as fs from 'fs';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { ILogObj, Logger } from 'tslog';

const CameraOffline = require.resolve('../../media/camera-offline.png');
const CameraDisabled = require.resolve('../../media/camera-disabled.png');
const SnapshotBlackPath = require.resolve('../../media/Snapshot-black.png');
const SnapshotUnavailable = require.resolve('../../media/Snapshot-Unavailable.png');

let MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN = 1; // should be incremented by 1 for every device

type Snapshot = {
  timestamp: number;
  image: Buffer;
  sourceUrl?: string;
};

type StreamSource = {
  url?: string;
  stream?: Readable;
  livestreamId?: number;
};

/**
 * possible performance settings:
 * 1. snapshots as current as possible (weak homebridge performance) -> forceRefreshSnapshot
 *    - always get a new image from cloud or cam
 * 2. balanced
 *    - start snapshot refresh but return snapshot as fast as possible
 *      if request takes too long old snapshot will be returned
 * 3. get an old snapshot immediately -> !forceRefreshSnapshot
 *    - wait on cloud snapshot with new events
 * 
 * extra options:
 *  - force refresh snapshots with interval
 *  - force immediate snapshot-reject when ringing
 * 
 * Drawbacks: elapsed time in homekit might be wrong
 */

export class SnapshotManager extends EventEmitter {

  private readonly platform: EufySecurityPlatform;
  private readonly device: Camera;
  private cameraConfig: CameraConfig;

  private readonly videoProcessor = ffmpegPath || 'ffmpeg';

  private currentSnapshot?: Snapshot;
  private blackSnapshot?: Buffer;
  private cameraOffline?: Buffer;
  private cameraDisabled?: Buffer;

  private refreshProcessRunning = false;
  private lastEvent = 0;
  private lastRingEvent = 0;

  public readonly log: Logger<ILogObj>;

  private snapshotRefreshTimer?: NodeJS.Timeout;

  // eslint-disable-next-line max-len
  constructor(
    camera: CameraAccessory,
    private livestreamManager: LocalLivestreamManager,
  ) {
    super();

    this.platform = camera.platform;
    this.device = camera.device;
    this.cameraConfig = camera.cameraConfig;
    this.log = camera.log;

    this.device.on('property changed', this.onPropertyValueChanged.bind(this));

    type DeviceEventType = keyof DeviceEvents;

    const eventTypes: DeviceEventType[] = [
      'motion detected',
      'person detected',
      'pet detected',
      'sound detected',
      'crying detected',
      'vehicle detected',
      'dog detected',
      'dog lick detected',
      'dog poop detected',
      'stranger person detected',
    ];

    eventTypes.forEach(eventType => {
      this.device.on(eventType, this.onEvent.bind(this));
    });

    this.device.on('rings', this.onRingEvent.bind(this));

    if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
      if (this.cameraConfig.refreshSnapshotIntervalMinutes < 5) {
        this.log.warn('The interval to automatically refresh snapshots is set too low. Minimum is one minute.');
        this.cameraConfig.refreshSnapshotIntervalMinutes = 5;
      }
      // eslint-disable-next-line max-len
      this.log.info('Setting up automatic snapshot refresh every ' + this.cameraConfig.refreshSnapshotIntervalMinutes + ' minutes. This may decrease battery life dramatically. The refresh process should begin in ' + MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN + ' minutes.');
      setTimeout(() => { // give homebridge some time to start up
        this.automaticSnapshotRefresh();
      }, MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN * 60 * 1000);
      MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN++;
    }

    if (this.cameraConfig.snapshotHandlingMethod === 1) {
      // eslint-disable-next-line max-len
      this.log.info('is set to generate new snapshots on events every time. This might reduce homebridge performance and increase power consumption.');
      if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
        // eslint-disable-next-line max-len
        this.log.warn('You have enabled automatic snapshot refreshing. It is recommened not to use this setting with forced snapshot refreshing.');
      }
    } else if (this.cameraConfig.snapshotHandlingMethod === 2) {
      this.log.info('is set to balanced snapshot handling.');
    } else if (this.cameraConfig.snapshotHandlingMethod === 3) {
      this.log.info('is set to handle snapshots with cloud images. Snapshots might be older than they appear.');
    } else {
      this.log.warn('unknown snapshot handling method. SNapshots will not be generated.');
    }

    try {
      this.blackSnapshot = fs.readFileSync(SnapshotBlackPath);
      if (this.cameraConfig.immediateRingNotificationWithoutSnapshot) {
        this.log.info('Empty snapshot will be sent on ring events immediately to speed up homekit notifications.');
      }
    } catch (err) {
      this.log.error('could not cache black snapshot file for further use: ' + err);
    }

    try {
      this.cameraOffline = fs.readFileSync(CameraOffline);
      if (this.cameraConfig.immediateRingNotificationWithoutSnapshot) {
        this.log.info('Empty snapshot will be sent on ring events immediately to speed up homekit notifications.');
      }
    } catch (err) {
      this.log.error('could not cache CameraOffline file for further use: ' + err);
    }

    try {
      this.cameraDisabled = fs.readFileSync(CameraDisabled);
      if (this.cameraConfig.immediateRingNotificationWithoutSnapshot) {
        this.log.info('Empty snapshot will be sent on ring events immediately to speed up homekit notifications.');
      }
    } catch (err) {
      this.log.error('could not cache CameraDisabled file for further use: ' + err);
    }

    try {
      const picture = this.device.getPropertyValue(PropertyName.DevicePicture) as Picture;
      if (picture && picture.type) {
        this.currentSnapshot = { timestamp: Date.now(), image: picture.data };
      } else {
        throw ('No currentSnapshot');
      }
    } catch (err) {
      this.log.error('could not fetch old snapshot: ' + err);
    }

  }

  private onRingEvent(device: Device, state: boolean) {
    if (state) {
      this.log.debug('Snapshot handler detected ring event.');
      this.lastRingEvent = Date.now();
    }
  }

  private onEvent(device: Device, state: boolean) {
    if (state) {
      this.log.debug('Snapshot handler detected event.');
      this.lastEvent = Date.now();
    }
  }

  public async getSnapshotBuffer(request: SnapshotRequest): Promise<Buffer> {
    // return a new snapshot if it is recent enough (not more than 15 seconds)
    if (this.currentSnapshot) {
      const diff = Math.abs((Date.now() - this.currentSnapshot.timestamp) / 1000);
      if (diff <= 15) {
        return this.resizeSnapshot(this.currentSnapshot.image, request);
      }
    }

    // It should never happend since camera is disabled in HK but in case of...
    if (!this.device.isEnabled()) {
      if (this.cameraDisabled) {
        return this.resizeSnapshot(this.cameraDisabled, request);
      } else {
        return Promise.reject('Something wrong with file systems. Looks likes not enought rights!');
      }
    }

    const diff = (Date.now() - this.lastRingEvent) / 1000;
    if (this.cameraConfig.immediateRingNotificationWithoutSnapshot && diff < 5) {
      this.log.debug('Sending empty snapshot to speed up homekit notification for ring event.');
      if (this.blackSnapshot) {
        return this.resizeSnapshot(this.blackSnapshot, request);
      } else {
        return Promise.reject('Prioritize ring notification over snapshot request. But could not supply empty snapshot.');
      }
    }

    let snapshot = Buffer.from([]);
    try {
      if (this.cameraConfig.snapshotHandlingMethod === 1) {
        // return a preferablly most recent snapshot every time
        snapshot = await this.getNewestSnapshotBuffer();
      } else if (this.cameraConfig.snapshotHandlingMethod === 2) {
        // balanced method
        snapshot = await this.getBalancedSnapshot();
      } else if (this.cameraConfig.snapshotHandlingMethod === 3) {
        // fastest method with potentially old snapshots
        snapshot = await this.getNewestCloudSnapshot();
      } else {
        return Promise.reject('No suitable handling method for snapshots defined');
      }
      return this.resizeSnapshot(snapshot, request);

    } catch (err) {
      this.log.error(err);
      return Promise.resolve(fs.readFileSync(SnapshotUnavailable));
    }
  }

  private async getNewestSnapshotBuffer(): Promise<Buffer> {
    return new Promise((resolve, reject) => {

      this.fetchCurrentCameraSnapshot().catch((err) => reject(err));

      const requestTimeout = setTimeout(() => {
        throw ('snapshot request timed out');
      }, 15000);

      this.once('new snapshot', () => {
        if (requestTimeout) {
          clearTimeout(requestTimeout);
        }

        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image);
        } else {
          throw ('Unknown snapshot request error');
        }
      });
    });
  }

  private async getBalancedSnapshot(): Promise<Buffer> {
    return new Promise((resolve) => {

      let snapshotTimeout = setTimeout(() => {
        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image);
        } else {
          throw ('No currentSnapshot');
        }
      }, 1000);

      this.fetchCurrentCameraSnapshot().catch((err) => this.log.warn(err));

      const newestEvent = (this.lastRingEvent > this.lastEvent) ? this.lastRingEvent : this.lastEvent;
      const diff = (Date.now() - newestEvent) / 1000;
      if (diff < 15) { // wait for cloud or camera snapshot
        this.log.debug('Waiting on cloud snapshot...');
        if (snapshotTimeout) {
          clearTimeout(snapshotTimeout);
        }
        snapshotTimeout = setTimeout(() => {
          if (this.currentSnapshot) {
            resolve(this.currentSnapshot.image);
          } else {
            throw ('No currentSnapshot');
          }
        }, 15000);
      }

      this.once('new snapshot', () => {
        if (snapshotTimeout) {
          clearTimeout(snapshotTimeout);
        }

        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image);
        } else {
          throw ('No currentSnapshot');
        }
      });
    });
  }

  private async getNewestCloudSnapshot(): Promise<Buffer> {
    return new Promise((resolve, reject) => {

      if (this.currentSnapshot) {
        resolve(this.currentSnapshot.image);
      } else {
        throw ('No currentSnapshot');
      }

    });
  }

  private automaticSnapshotRefresh() {
    this.log.debug('Automatic snapshot refresh triggered.');
    this.fetchCurrentCameraSnapshot().catch((err) => this.log.warn(err));
    if (this.snapshotRefreshTimer) {
      clearTimeout(this.snapshotRefreshTimer);
    }
    if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
      this.snapshotRefreshTimer = setTimeout(() => {
        this.automaticSnapshotRefresh();
      }, this.cameraConfig.refreshSnapshotIntervalMinutes * 60 * 1000);
    }
  }

  private storeImage(file: string, image: Buffer) {
    const filePath = `${this.platform.eufyPath}/${file}`;
    try {
      fs.writeFileSync(filePath, image);
      this.log.debug(`Stored Image: ${filePath}`);
    } catch (error) {
      this.log.debug(`Error: ${filePath} - ${error}`);
    }
  }

  private async onPropertyValueChanged(device: Device, name: string): Promise<void> {
    if (name === 'picture') {
      const picture = device.getPropertyValue(PropertyName.DevicePicture) as Picture;
      if (picture && picture.type) {
        this.storeImage(`${device.getSerial()}.${picture.type.ext}`, picture.data);
        this.currentSnapshot = { timestamp: Date.now(), image: picture.data };
        this.emit('new snapshot');
      }
    }
  }

  private async fetchCurrentCameraSnapshot(): Promise<void> {
    if (this.refreshProcessRunning) {
      return Promise.resolve();
    }
    this.refreshProcessRunning = true;
    this.log.debug('Locked refresh process.');
    this.log.debug('Fetching new snapshot from camera.');
    const timestamp = Date.now();
    try {
      const snapshotBuffer = await this.getCurrentCameraSnapshot();
      this.refreshProcessRunning = false;
      this.log.debug('Unlocked refresh process.');

      this.log.debug('store new snapshot from camera in memory. Using this for future use.');
      this.currentSnapshot = {
        timestamp: timestamp,
        image: snapshotBuffer,
      };
      this.emit('new snapshot');

      return Promise.resolve();
    } catch (err) {
      this.refreshProcessRunning = false;
      this.log.debug('Unlocked refresh process.');
      return Promise.reject(err);
    }
  }

  private async getCurrentCameraSnapshot(): Promise<Buffer> {
    const source = await this.getCameraSource();

    if (!source) {
      return Promise.reject('No camera source detected.');
    }

    const parameters = await FFmpegParameters.forSnapshot(this.cameraConfig.videoConfig?.debug);

    if (source.url) {
      parameters.setInputSource(source.url);
    } else if (source.stream && source.livestreamId) {
      await parameters.setInputStream(source.stream);
    } else {
      return Promise.reject('No valid camera source detected.');
    }

    if (this.cameraConfig.delayCameraSnapshot) {
      parameters.setDelayedSnapshot();
    }

    try {
      const ffmpeg = new FFmpeg(
        `[Snapshot Process]`,
        parameters,
      );
      const buffer = await ffmpeg.getResult();

      if (source.livestreamId) {
        this.livestreamManager.stopProxyStream(source.livestreamId);
      }

      return Promise.resolve(buffer);
    } catch (err) {
      if (source.livestreamId) {
        this.livestreamManager.stopProxyStream(source.livestreamId);
      }
      return Promise.reject(err);
    }
  }

  private async getCameraSource(): Promise<StreamSource | null> {
    if (is_rtsp_ready(this.device, this.cameraConfig)) {
      try {
        const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
        this.log.debug('RTSP URL: ' + url);
        return {
          url: url as string,
        };
      } catch (err) {
        this.log.warn('Could not get snapshot from rtsp stream!');
        return null;
      }
    } else {
      try {
        const streamData = await this.livestreamManager.getLocalLivestream();
        return {
          stream: streamData.videostream,
          livestreamId: streamData.id,
        };
      } catch (err) {
        this.log.warn('Could not get snapshot from livestream!');
        return null;
      }
    }
  }

  private async resizeSnapshot(snapshot: Buffer, request: SnapshotRequest): Promise<Buffer> {

    const parameters = await FFmpegParameters.forSnapshot(this.cameraConfig.videoConfig?.debug);
    parameters.setup(this.cameraConfig, request);

    const ffmpeg = new FFmpeg(
      `[Snapshot Resize Process]`,
      parameters,
    );
    return ffmpeg.getResult(snapshot);
  }
}