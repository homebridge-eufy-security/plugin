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

  private readonly videoProcessor = ffmpegPath || 'ffmpeg';

  private currentSnapshot?: Snapshot;
  private blackSnapshot?: Buffer;
  private cameraOffline?: Buffer;
  private cameraDisabled?: Buffer;
  private unavailableSnapshot?: Buffer;

  private refreshProcessRunning = false;
  private lastEvent = 0;
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

  private storeSnapshotForCache(data: Buffer, time?: number): void {
    this.currentSnapshot = { timestamp: time ??= Date.now(), image: data };
  }

  public async getSnapshotBufferResized(request: SnapshotRequest): Promise<Buffer> {
    return await this.resizeSnapshot(await this.getSnapshotBuffer(), request);
  }

  private async getSnapshotBuffer(): Promise<Buffer> {
    // return a new snapshot if it is recent enough (not more than 15 seconds)
    if (this.currentSnapshot) {
      const diff = Math.abs((Date.now() - this.currentSnapshot.timestamp) / 1000);
      if (diff <= 15) {
        return this.currentSnapshot.image;
      }
    }

    // It should never happend since camera is disabled in HK but in case of...
    if (!this.device.isEnabled()) {
      if (this.cameraDisabled) {
        return this.cameraDisabled;
      } else {
        return Promise.reject('Something wrong with file systems. Looks likes not enought rights!');
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

    let snapshot = Buffer.from([]);
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

    } catch {
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
      // Set a timeout for the snapshot request
      const requestTimeout = setTimeout(() => {
        reject('getSnapshotFromStream timed out');
      }, 4 * 1000);

      // Define a listener for the 'new snapshot' event
      const snapshotListener = () => {
        clearTimeout(requestTimeout); // Clear the timeout if the snapshot is received
        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image); // Resolve the promise with the snapshot image
        } else {
          reject('getSnapshotFromStream error'); // Reject if there's an issue with the snapshot
        }
      };

      // Fetch the current camera snapshot and attach the 'new snapshot' listener
      this.fetchCurrentCameraSnapshot()
        .then(() => {
          this.once('new snapshot', snapshotListener); // Listen for the 'new snapshot' event
        })
        .catch((error) => {
          clearTimeout(requestTimeout); // Clear the timeout if an error occurs during fetching
          reject(error); // Reject the promise with the error
        });
    });
  }

  /**
   * Retrieves the newest cloud snapshot's image data.
   * @returns Buffer The image data as a Buffer.
   * @throws Error if there's no currentSnapshot available.
   */
  private getSnapshotFromCache(): Buffer {
    // Check if there's a currentSnapshot available
    if (this.currentSnapshot) {
      // If available, return the image data
      return this.currentSnapshot.image;
    } else {
      // If not available, throw an error
      throw new Error('No currentSnapshot available');
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
        this.storeSnapshotForCache(picture.data);
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