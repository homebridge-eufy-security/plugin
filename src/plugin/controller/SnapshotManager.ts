import https from 'node:https';
import { readFileSync } from 'node:fs';
import { EventEmitter, Readable } from 'node:stream';

import { Camera, Device, Picture, PropertyName, PropertyValue } from 'eufy-security-client';
import ffmpegPath from 'ffmpeg-for-homebridge';

import { CameraConfig } from '../utils/configTypes';
import { EufySecurityPlatform } from '../platform';
import { LocalLivestreamManager } from './LocalLivestreamManager';
import { Logger as TsLogger, ILogObj } from 'tslog';

import { is_rtsp_ready } from '../utils/utils';
import { SnapshotRequest } from 'homebridge';
import { FFmpeg, FFmpegParameters } from '../utils/ffmpeg';
import { StreamingDelegate } from './streamingDelegate';
import { CameraAccessory } from '../accessories/CameraAccessory';
import sharp from 'sharp';

const SnapshotBlackPath = require.resolve('../../media/Snapshot-black.png');
const SnapshotUnavailablePath = require.resolve('../../media/Snapshot-Unavailable.png');

let MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN = 1; // should be incremented by 1 for every device

type Snapshot = {
  timestamp: number;
  image: Buffer;
};

type ImageDataResponse = {
  url: string;
  image: Buffer;
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

  private readonly platform: EufySecurityPlatform = this.streamingDelegate.platform;
  private readonly device: Camera = this.streamingDelegate.device;
  private readonly accessory: CameraAccessory = this.streamingDelegate.camera;
  private cameraConfig: CameraConfig = this.streamingDelegate.cameraConfig;
  private cameraName: string = this.device.getName();

  private readonly videoProcessor = ffmpegPath || 'ffmpeg';

  private log: TsLogger<ILogObj> = this.platform.log;
  private livestreamManager: LocalLivestreamManager = this.streamingDelegate.localLivestreamManager;

  private lastCloudSnapshot?: Snapshot;
  private currentSnapshot?: Snapshot;
  private blackSnapshot?: Buffer = readFileSync(SnapshotBlackPath);
  private UnavailableSnapshot?: Buffer = readFileSync(SnapshotUnavailablePath);

  private refreshProcessRunning = false;
  private lastEvent = 0;
  private lastRingEvent = 0;

  private snapshotRefreshTimer?: NodeJS.Timeout;

  // eslint-disable-next-line max-len
  constructor(
    private streamingDelegate: StreamingDelegate,
  ) {
    super();

    this.device.on('property changed', this.onPropertyValueChanged.bind(this));
    this.device.on('rings', (device, state) => this.onRingEvent(device, state));

    this.accessory.eventTypesToHandle.forEach(eventType => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.device.on(eventType, (device: Device, state: boolean) => this.onEvent(device, state));
    });

    if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
      if (this.cameraConfig.refreshSnapshotIntervalMinutes < 5) {
        this.log.warn(this.cameraName, 'The interval to automatically refresh snapshots is set too low. Minimum is one minute.');
        this.cameraConfig.refreshSnapshotIntervalMinutes = 5;
      }
      // eslint-disable-next-line max-len
      this.log.info(this.cameraName, 'Setting up automatic snapshot refresh every ' + this.cameraConfig.refreshSnapshotIntervalMinutes + ' minutes. This may decrease battery life dramatically. The refresh process for ' + this.cameraName + ' should begin in ' + MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN + ' minutes.');
      setTimeout(() => { // give homebridge some time to start up
        this.automaticSnapshotRefresh();
      }, MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN * 60 * 1000);
      MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN++;
    }

    if (this.cameraConfig.snapshotHandlingMethod === 1) {
      // eslint-disable-next-line max-len
      this.log.info(this.cameraName, 'is set to generate new snapshots on events every time. This might reduce homebridge performance and increase power consumption.');
      if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
        // eslint-disable-next-line max-len
        this.log.warn(this.cameraName, 'You have enabled automatic snapshot refreshing. It is recommened not to use this setting with forced snapshot refreshing.');
      }
    } else if (this.cameraConfig.snapshotHandlingMethod === 2) {
      this.log.info(this.cameraName, 'is set to balanced snapshot handling.');
    } else if (this.cameraConfig.snapshotHandlingMethod === 3) {
      this.log.info(this.cameraName, 'is set to handle snapshots with cloud images. Snapshots might be older than they appear.');
    } else {
      this.log.warn(this.cameraName, 'unknown snapshot handling method. SNapshots will not be generated.');
    }

    try {
      if (this.cameraConfig.immediateRingNotificationWithoutSnapshot) {
        this.log.info(this.cameraName, 'Empty snapshot will be sent on ring events immediately to speed up homekit notifications.');
      }
    } catch (err) {
      this.log.error(this.cameraName, 'could not cache black snapshot file for further use: ' + err);
    }

    this.getSnapshotFromCloud() // get current cloud snapshot for balanced mode scenarios -> first snapshot can be resolved
      .catch(err => this.log.warn(this.cameraName,
        'snapshot handler is initialized without cloud snapshot. Maybe no snapshot will displayed the first times.'));
  }

  private onRingEvent(device: Device, state: boolean) {
    if (state) {
      this.log.debug(this.cameraName, 'Snapshot handler detected ring event.');
      this.lastRingEvent = Date.now();
    }
  }

  private async onEvent(device: Device, state: boolean) {
    if (state) {
      this.log.debug(this.cameraName, 'Snapshot handler detected event.');
      this.lastEvent = Date.now();
    } else {
      this.platform.eufyClient.refreshCloudData()
        .then(() => this.getSnapshotFromCloud());
    }
  }

  private async onPropertyValueChanged(device: Device, name: string, value: PropertyValue): Promise<void> {
    if (name === 'picture') {
      this.log.debug(this.cameraName, 'New picture DATA event');
      this.getSnapshotFromCloud();
    }
  }

  public async getSnapshotBuffer(request: SnapshotRequest): Promise<Buffer> {
    const now = Date.now();

    // Return a recent snapshot if available
    if (this.currentSnapshot && Math.abs((now - this.currentSnapshot.timestamp) / 1000) <= 15) {
      this.log.debug('Returning recent snapshot.');
      return this.resizeSnapshot(this.currentSnapshot.image, request);
    }

    // Send empty snapshot to prioritize ring notification, if applicable
    if (this.cameraConfig.immediateRingNotificationWithoutSnapshot && (now - this.lastRingEvent) / 1000 < 5) {
      if (this.blackSnapshot) {
        this.log.debug('Sending black snapshot to prioritize ring notification.');
        return this.resizeSnapshot(this.blackSnapshot, request);
      } else {
        this.log.debug('Unable to send black snapshot - prioritizing ring notification over snapshot request.');
        return Promise.reject('Prioritize ring notification over snapshot request. But could not supply empty snapshot.');
      }
    }

    // Fetch snapshot based on handling method
    try {
      let snapshot = Buffer.from([]);

      switch (this.cameraConfig.snapshotHandlingMethod) {
        case 1:
          this.log.debug('Fetching the newest snapshot buffer.');
          snapshot = await this.getNewestSnapshotBuffer();
          break;
        case 2:
          this.log.debug('Fetching a balanced snapshot.');
          snapshot = await this.getBalancedSnapshot();
          break;
        case 3:
          this.log.debug('Fetching the newest cloud snapshot.');
          snapshot = await this.getNewestCloudSnapshot();
          break;
        default:
          this.log.debug('No suitable snapshot handling method defined.');
          return Promise.reject('No suitable handling method for snapshots defined');
      }

      return this.resizeSnapshot(snapshot, request);
    } catch (err) {
      this.log.error('Error fetching snapshot:', err);
      return this.resizeSnapshot(this.UnavailableSnapshot!, request);
    }
  }

  private async getNewestSnapshotBuffer(): Promise<Buffer> {
    return new Promise((resolve, reject) => {

      this.fetchCurrentCameraSnapshot().catch((err) => reject(err));

      const requestTimeout = setTimeout(() => {
        reject('snapshot request timed out');
      }, 15000);

      this.once('new snapshot', () => {
        if (requestTimeout) {
          clearTimeout(requestTimeout);
        }

        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image);
        } else {
          reject('Unknown snapshot request error');
        }
      });
    });
  }

  private async getBalancedSnapshot(): Promise<Buffer> {
    return new Promise((resolve, reject) => {

      let snapshotTimeout = setTimeout(() => {
        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image);
        } else {
          reject('No snapshot in memory');
        }
      }, 1000);

      this.fetchCurrentCameraSnapshot().catch((err) => this.log.warn(this.cameraName, err));

      const newestEvent = (this.lastRingEvent > this.lastEvent) ? this.lastRingEvent : this.lastEvent;
      const diff = (Date.now() - newestEvent) / 1000;
      if (diff < 15) { // wait for cloud or camera snapshot
        this.log.debug(this.cameraName, 'Waiting on cloud snapshot...');
        if (snapshotTimeout) {
          clearTimeout(snapshotTimeout);
        }
        snapshotTimeout = setTimeout(() => {
          if (this.currentSnapshot) {
            resolve(this.currentSnapshot.image);
          } else {
            reject('No snapshot in memory');
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
          reject('No snapshot in memory');
        }
      });
    });
  }

  private async getNewestCloudSnapshot(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const newestEvent = Math.max(this.lastRingEvent, this.lastEvent);
      const diffInSeconds = (Date.now() - newestEvent) / 1000;

      if (diffInSeconds < 15) {
        this.log.debug(this.cameraName, 'Waiting on cloud snapshot...');

        const snapshotTimeout = setTimeout(() => {
          reject('No snapshot has been retrieved in time from eufy cloud.');
        }, 15000);

        this.once('new snapshot', () => {
          clearTimeout(snapshotTimeout);
          if (this.currentSnapshot) {
            resolve(this.currentSnapshot.image);
          } else {
            reject('No snapshot in memory');
          }
        });
      } else {
        // Directly resolve or reject based on currentSnapshot's availability
        this.currentSnapshot ? resolve(this.currentSnapshot.image) : reject('No snapshot in memory');
      }
    });
  }

  private automaticSnapshotRefresh() {
    this.log.debug(this.cameraName, 'Automatic snapshot refresh triggered.');
    this.fetchCurrentCameraSnapshot().catch((err) => this.log.warn(this.cameraName, err));
    if (this.snapshotRefreshTimer) {
      clearTimeout(this.snapshotRefreshTimer);
    }
    if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
      this.snapshotRefreshTimer = setTimeout(() => {
        this.automaticSnapshotRefresh();
      }, this.cameraConfig.refreshSnapshotIntervalMinutes * 60 * 1000);
    }
  }

  /**
   * Asynchronously retrieves a snapshot from the cloud.
   * If no previous snapshots are available, it sets the last and current snapshots to the fetched image.
   * @returns Promise<void>
   */
  private async getSnapshotFromCloud(): Promise<void> {
    try {
      const image = this.device.getPropertyValue(PropertyName.DevicePicture) as Picture;
      this.log.debug(this.cameraName, 'trying to download latest cloud snapshot for future use');
      if (!this.lastCloudSnapshot && !this.currentSnapshot) {
        this.lastCloudSnapshot = {
          timestamp: Date.now() - 60 * 60 * 1000, // An hour earlier
          image: image.data,
        };
        this.currentSnapshot = this.lastCloudSnapshot;
        this.log.debug(this.cameraName, 'Stored cloud snapshot for future use.');
        this.emit('new snapshot');
      }
      return Promise.resolve();
    } catch (err) {
      this.log.warn(this.cameraName, 'Couldt not get cloud snapshot: ' + err);
      return Promise.reject(err);
    }
  }

  /**
   * Fetches the current camera snapshot and updates the current snapshot state.
   * This function will exit early if a refresh process is already running.
   * @returns Promise<void>
   */
  private async fetchCurrentCameraSnapshot(): Promise<void> {
    if (this.refreshProcessRunning) {
      return;
    }

    this.refreshProcessRunning = true;
    this.log.debug(`${this.cameraName} Locked refresh process.`);
    this.log.debug(`${this.cameraName} Fetching new snapshot from camera.`);

    const timestamp = Date.now();

    try {
      const snapshotBuffer = await this.getCurrentCameraSnapshot();

      this.log.debug(`${this.cameraName} Store new snapshot from camera in memory for future use.`);
      this.currentSnapshot = {
        timestamp: timestamp,
        image: snapshotBuffer,
      };
      this.emit('new snapshot');
    } catch (err) {
      this.log.warn(`${this.cameraName} Error fetching snapshot: ${err}`);
      throw err;
    } finally {
      this.refreshProcessRunning = false;
      this.log.debug(`${this.cameraName} Unlocked refresh process.`);
    }
  }

  /**
   * Retrieves the camera source for capturing snapshots.
   * 
   * This method determines the appropriate camera source based on the camera configuration
   * and device capabilities. It supports fetching the RTSP stream URL directly from the device
   * if the RTSP service is ready. Otherwise, it attempts to fetch a local live stream source.
   * 
   * @returns {Promise<StreamSource>} A promise that resolves to the camera source object.
   * @throws Throws an error if the camera source cannot be determined or retrieved.
   */
  private async getCameraSource(): Promise<StreamSource> {
    if (is_rtsp_ready(this.device, this.cameraConfig, this.log)) {
      const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
      this.log.debug(`${this.cameraName} RTSP URL: ${url}`);
      return { url: url as string };
    } else {
      const streamData = await this.livestreamManager.getLocalLivestream();
      return { stream: streamData.videostream, livestreamId: 1 };
    }
  }

  /**
   * Captures a snapshot from the current camera source.
   * 
   * This method first retrieves the current camera source. Depending on the source type (URL or stream),
   * it configures the FFmpeg parameters accordingly. If a delay is configured for the camera snapshot,
   * it sets up the delayed snapshot parameter. The method then uses FFmpeg to capture the snapshot and
   * returns the result as a buffer. If capturing from a live stream, it ensures to stop the live stream
   * after capturing the snapshot or in case of an error.
   * 
   * @returns {Promise<Buffer>} A promise that resolves to the snapshot captured as a buffer.
   * @throws Throws an error if no valid camera source is detected or if the snapshot capturing process fails.
   */
  private async getCurrentCameraSnapshot(): Promise<Buffer> {
    const source = await this.getCameraSource();
    const parameters = await FFmpegParameters.create({ type: 'snapshot', debug: this.cameraConfig.videoConfig?.debug });

    if (source.url) {
      parameters.setInputSource(source.url);
    } else if (source.stream && source.livestreamId) {
      await parameters.setInputStream(source.stream);
    } else {
      throw new Error('No valid camera source detected.');
    }

    if (this.cameraConfig.delayCameraSnapshot) {
      parameters.setDelayedSnapshot();
    }

    try {
      const ffmpeg = new FFmpeg(`[${this.cameraName}] [Snapshot Process]`, [parameters], this.platform.ffmpegLogger);
      return await ffmpeg.getResult();
    } finally {
      if (source.livestreamId) {
        this.livestreamManager.stopLocalLiveStream();
      }
    }
  }

  /**
   * Resizes a given snapshot image buffer to the specified dimensions.
   * 
   * This function utilizes the Sharp library to resize an image buffer. The image is resized
   * to the width and height specified in the SnapshotRequest object. Sharp provides a more
   * efficient and Node.js-native way of handling image processing compared to FFmpeg.
   * 
   * @param {Buffer} snapshot - The image buffer to be resized.
   * @param {SnapshotRequest} request - The object containing the desired dimensions.
   * @returns {Promise<Buffer>} A Promise that resolves to the resized image buffer.
   * @throws Will throw an error if the resizing process fails.
   */
  private async resizeSnapshot(snapshot: Buffer, request: SnapshotRequest): Promise<Buffer> {
    try {
      // Using Sharp to resize the image
      const resizedImage = await sharp(snapshot)
        .resize(request.width, request.height)
        .toBuffer();

      return resizedImage;
    } catch (error) {
      this.log.error('Error resizing snapshot:', error);
      throw error;
    }
  }
}