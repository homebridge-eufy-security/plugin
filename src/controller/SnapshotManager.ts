import { EventEmitter, Readable } from 'stream';

import { Camera, Device, DeviceEvents, Picture, PropertyName } from 'eufy-security-client';

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
};

type StreamSource = {
  url?: string;
  stream?: Readable;
};

/**
 * possible performance settings:
 * 1. snapshots as current as possible (weak homebridge performance)
 *    - always get a new image from cloud or cam
 * 2. balanced
 *    - start snapshot refresh but return snapshot as fast as possible
 *      if request takes too long old snapshot will be returned
 * 3. get an old snapshot immediately
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

  private currentSnapshot?: Snapshot;
  private blackSnapshot?: Buffer;
  private cameraOffline?: Buffer;
  private cameraDisabled?: Buffer;
  private unavailableSnapshot?: Buffer;

  private refreshProcessRunning = false;
  private lastRingEvent = 0;

  public readonly log: Logger<ILogObj>;

  private snapshotRefreshTimer?: NodeJS.Timeout;

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

    // Listen for all detection and ring events to pre-fetch a fresh snapshot
    const detectionEvents: (keyof DeviceEvents)[] = [
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
      'rings',
    ];

    detectionEvents.forEach(eventType => {
      this.device.on(eventType, this.onDeviceEvent.bind(this, eventType));
    });

    if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
      if (this.cameraConfig.refreshSnapshotIntervalMinutes < 5) {
        this.log.warn('The interval to automatically refresh snapshots is set too low. Minimum is one minute.');
        this.cameraConfig.refreshSnapshotIntervalMinutes = 5;
      }
      this.log.info('Setting up automatic snapshot refresh every ' + this.cameraConfig.refreshSnapshotIntervalMinutes + ' minutes. This may decrease battery life dramatically. The refresh process should begin in ' + MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN + ' minutes.');
      setTimeout(() => { // give homebridge some time to start up
        this.automaticSnapshotRefresh();
      }, MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN * 60 * 1000);
      MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN++;
    }

    if (this.cameraConfig.snapshotHandlingMethod === 1) {
      this.log.info('is set to generate new snapshots on events every time. This might reduce homebridge performance and increase power consumption.');
      if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
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
    } catch (error) {
      this.log.error('could not cache black snapshot file for further use: ' + error);
    }

    try {
      this.unavailableSnapshot = fs.readFileSync(SnapshotUnavailable);
    } catch (error) {
      this.log.error('could not cache SnapshotUnavailable file for further use: ' + error);
    }

    try {
      this.cameraOffline = fs.readFileSync(CameraOffline);
    } catch (error) {
      this.log.error('could not cache CameraOffline file for further use: ' + error);
    }

    try {
      this.cameraDisabled = fs.readFileSync(CameraDisabled);
    } catch (error) {
      this.log.error('could not cache CameraDisabled file for further use: ' + error);
    }

    try {
      const picture = this.device.getPropertyValue(PropertyName.DevicePicture) as Picture;
      if (picture && picture.type) {
        this.storeSnapshotForCache(picture.data, 0);
      } else {
        throw new Error('No currentSnapshot');
      }
    } catch (error) {
      this.log.error('could not fetch old snapshot: ' + error);
    }

  }

  private onDeviceEvent(eventType: keyof DeviceEvents, device: Device, state: boolean) {
    if (!state) {
      return;
    }

    this.log.debug(`Snapshot handler detected event: ${eventType}`);

    if (eventType === 'rings') {
      this.lastRingEvent = Date.now();
    }

    // Pre-fetch a fresh snapshot so it's ready when HomeKit asks
    this.fetchCurrentCameraSnapshot().catch((error) =>
      this.log.debug(`Background snapshot refresh on ${eventType} failed: ${error}`),
    );
  }

  private storeSnapshotForCache(data: Buffer, time?: number): void {
    this.currentSnapshot = { timestamp: time ??= Date.now(), image: data };
  }

  public async getSnapshotBufferResized(request: SnapshotRequest): Promise<Buffer> {
    return await this.resizeSnapshot(await this.getSnapshotBuffer(), request);
  }

  private async getSnapshotBuffer(): Promise<Buffer> {
    // Check device state first, before returning any cached snapshot
    if (!this.device.isEnabled()) {
      this.log.debug('Device is disabled, returning disabled snapshot.');
      if (this.cameraDisabled) {
        return this.cameraDisabled;
      } else {
        return Promise.reject('Something wrong with file systems. Looks like not enough rights!');
      }
    }

    // return a new snapshot if it is recent enough (not more than 15 seconds)
    if (this.currentSnapshot) {
      const diff = Math.abs((Date.now() - this.currentSnapshot.timestamp) / 1000);
      if (diff <= 15) {
        return this.currentSnapshot.image;
      }
    }

    const diff = (Date.now() - this.lastRingEvent) / 1000;
    if (this.cameraConfig.immediateRingNotificationWithoutSnapshot && diff < 5) {
      this.log.debug('Sending empty snapshot to speed up homekit notification for ring event.');
      if (this.blackSnapshot) {
        return this.blackSnapshot;
      } else {
        return Promise.reject('Prioritize ring notification over snapshot request. But could not supply empty snapshot.');
      }
    }

    let snapshot: Buffer = Buffer.from([]);
    try {
      if (this.cameraConfig.snapshotHandlingMethod === 1) {
        // return a preferablly most recent snapshot every time
        snapshot = await this.getSnapshotFromStream();
      } else if (this.cameraConfig.snapshotHandlingMethod === 2) {
        // balanced method
        snapshot = await this.getBalancedSnapshot();
      } else if (this.cameraConfig.snapshotHandlingMethod === 3) {
        // fastest method with potentially old snapshots
        snapshot = await this.getSnapshotFromCache();
      } else {
        return Promise.reject('No suitable handling method for snapshots defined');
      }
      return snapshot;

    } catch (err) {
      this.log.warn('Snapshot retrieval failed, falling back to cache:', err);
      try {
        return this.getSnapshotFromCache();
      } catch (error) {
        this.log.error(error);
        if (this.unavailableSnapshot) {
          return this.unavailableSnapshot;
        } else {
          throw (error);
        }
      }
    }
  }

  /**
   * Retrieves the newest snapshot buffer asynchronously.
   * @returns A Promise resolving to a Buffer containing the newest snapshot image.
   */
  private getSnapshotFromStream(): Promise<Buffer> {
    this.log.info(`Begin live streaming to access the most recent snapshot (significant battery drain on the device)`);
    return new Promise((resolve, reject) => {
      let settled = false;

      // Define a listener for the 'new snapshot' event
      const snapshotListener = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(requestTimeout);
        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image);
        } else {
          reject('getSnapshotFromStream error');
        }
      };

      // Set a timeout for the snapshot request
      const requestTimeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        this.removeListener('new snapshot', snapshotListener);
        reject('getSnapshotFromStream timed out');
      }, 4 * 1000);

      // Register listener BEFORE starting fetch to avoid missing the event
      this.once('new snapshot', snapshotListener);

      // Fetch the current camera snapshot
      this.fetchCurrentCameraSnapshot()
        .catch((error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(requestTimeout);
          this.removeListener('new snapshot', snapshotListener);
          reject(error);
        });
    });
  }

  /**
   * Retrieves the newest cloud snapshot's image data.
   * @returns Buffer The image data as a Buffer.
   * @throws Error if there's no currentSnapshot available and no fallback image.
   */
  private getSnapshotFromCache(): Buffer {
    // Check if there's a currentSnapshot available
    if (this.currentSnapshot) {
      // If available, return the image data
      return this.currentSnapshot.image;
    } else {
      // If not available, try to use the unavailable snapshot image
      if (this.unavailableSnapshot) {
        this.log.warn('No currentSnapshot available, using fallback unavailable snapshot image');
        return this.unavailableSnapshot;
      } else {
        // If fallback image is also not available, throw an error
        throw new Error('No currentSnapshot available');
      }
    }
  }

  private async getBalancedSnapshot(): Promise<Buffer> {
    if (this.currentSnapshot) {
      const diff = Math.abs((Date.now() - this.currentSnapshot.timestamp) / 1000);
      if (diff <= 30) {
        return this.currentSnapshot.image;
      }
    }
    return this.getSnapshotFromStream();
  }

  private automaticSnapshotRefresh() {
    this.log.debug('Automatic snapshot refresh triggered.');
    this.fetchCurrentCameraSnapshot().catch((error) => this.log.warn(error));
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
        // Don't overwrite a recent stream snapshot (less than 30s old) with a cloud image
        if (this.currentSnapshot && (Date.now() - this.currentSnapshot.timestamp) < 30 * 1000) {
          this.log.debug('Skipping cloud snapshot update, a recent stream snapshot already exists.');
        } else {
          this.storeSnapshotForCache(picture.data);
          this.emit('new snapshot');
        }
      }
    }

    if (name === 'enabled') {
      const enabled = device.getPropertyValue(PropertyName.DeviceEnabled) as boolean;
      this.log.info(`Device enabled state changed to: ${enabled}`);
      if (enabled) {
        // Clear stale snapshot so the next request fetches a fresh one
        this.currentSnapshot = undefined;
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
    try {
      const snapshotBuffer = await this.getCurrentCameraSnapshot();
      this.refreshProcessRunning = false;
      this.log.debug('Unlocked refresh process.');

      this.log.debug('store new snapshot from camera in memory. Using this for future use.');
      this.storeSnapshotForCache(snapshotBuffer);
      this.emit('new snapshot');

      return Promise.resolve();
    } catch (error) {
      this.refreshProcessRunning = false;
      this.log.debug('Unlocked refresh process.');
      return Promise.reject(error);
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
    } else if (source.stream) {
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

      this.livestreamManager.stopLocalLiveStream();

      return Promise.resolve(buffer);
    } catch (error) {
      this.livestreamManager.stopLocalLiveStream();
      return Promise.reject(error);
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
      } catch (error) {
        this.log.warn('Could not get snapshot from rtsp stream!', error);
        return null;
      }
    } else {
      try {
        const streamData = await this.livestreamManager.getLocalLivestream();
        return {
          stream: streamData.videostream,
        };
      } catch (error) {
        this.log.warn('Could not get snapshot from livestream!', error);
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