/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs';
import { EventEmitter, Readable } from 'node:stream';

import { Camera, Device, Picture, PropertyName } from 'eufy-security-client';

import { CameraConfig } from '../utils/configTypes';
import { EufySecurityPlatform } from '../platform';
import { LocalLivestreamManager } from './LocalLivestreamManager';

import { is_rtsp_ready, log } from '../utils/utils';
import { SnapshotRequest } from 'homebridge';
import { FFmpeg } from '../utils/ffmpeg';
import { StreamingDelegate } from './streamingDelegate';
import { CameraAccessory } from '../accessories/CameraAccessory';
import sharp from 'sharp';
import { FFmpegParameters } from '../utils/ffmpeg-params';

const EXTENDED_WAIT_MS = 15000;
const SNAPSHOT_WAIT_THRESHOLD_SECONDS = 30;
const MILLISECONDS_PER_MINUTE = 60 * 1000;

const SnapshotBlack = readFileSync(require.resolve('../../media/Snapshot-black.png'));
const SnapshotUnavailable = readFileSync(require.resolve('../../media/Snapshot-Unavailable.png'));

let MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN = 1; // should be incremented by 1 for every device

type Snapshot = {
  timestamp: number;
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

  private readonly platform: EufySecurityPlatform;
  private readonly device: Camera;
  private readonly accessory: CameraAccessory;
  private cameraConfig: CameraConfig;
  private cameraName: string;

  private livestreamManager: LocalLivestreamManager;

  private lastCloudSnapshot?: Snapshot;
  private currentSnapshot?: Snapshot;

  private refreshProcessRunning = false;
  private refreshSnapshotIntervalMinutes = 0;

  private lastEvent = 0;
  private lastRingEvent = 0;
  private lastImageEvent = 0;

  private snapshotRefreshTimer?: NodeJS.Timeout;

  // eslint-disable-next-line max-len
  constructor(
    private streamingDelegate: StreamingDelegate,
  ) {
    super();

    this.platform = this.streamingDelegate.platform;
    this.device = this.streamingDelegate.device;
    this.accessory = this.streamingDelegate.camera;
    this.cameraConfig = this.streamingDelegate.cameraConfig;
    this.cameraName = this.device.getName();

    this.livestreamManager = this.streamingDelegate.localLivestreamManager;

    this.refreshSnapshotIntervalMinutes = this.cameraConfig.refreshSnapshotIntervalMinutes ?? 0;

    this.device.on('property changed', this.onPropertyValueChanged.bind(this));
    this.device.on('rings', this.onRingEvent.bind(this));

    this.accessory.eventTypesToHandle.forEach(eventType => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.device.on(eventType, (device: Device, state: boolean) => this.onMotionEvent(device, state));
    });

    if (this.refreshSnapshotIntervalMinutes) {
      if (this.refreshSnapshotIntervalMinutes < 5) {
        log.warn(this.cameraName, 'The interval to automatically refresh snapshots is set too low. Minimum is one minute.');
        this.refreshSnapshotIntervalMinutes = 5;
      }
      // eslint-disable-next-line max-len
      log.info(this.cameraName, 'Setting up automatic snapshot refresh every ' + this.refreshSnapshotIntervalMinutes + ' minutes. This may decrease battery life dramatically. The refresh process for ' + this.cameraName + ' should begin in ' + MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN + ' minutes.');
      setTimeout(() => { // give homebridge some time to start up
        this.automaticSnapshotRefresh();
      }, MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN * MILLISECONDS_PER_MINUTE);
      MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN++;
    }

    if (this.cameraConfig.snapshotHandlingMethod === 1) {
      // eslint-disable-next-line max-len
      log.info(this.cameraName, 'is set to generate new snapshots on events every time. This might reduce homebridge performance and increase power consumption.');
      if (this.refreshSnapshotIntervalMinutes) {
        // eslint-disable-next-line max-len
        log.warn(this.cameraName, 'You have enabled automatic snapshot refreshing. It is recommened not to use this setting with forced snapshot refreshing.');
      }
    } else if (this.cameraConfig.snapshotHandlingMethod === 2) {
      log.info(this.cameraName, 'is set to balanced snapshot handling.');
    } else if (this.cameraConfig.snapshotHandlingMethod === 3) {
      log.info(this.cameraName, 'is set to handle snapshots with cloud images. Snapshots might be older than they appear.');
    } else {
      log.warn(this.cameraName, 'unknown snapshot handling method. SNapshots will not be generated.');
    }

    try {
      if (this.cameraConfig.immediateRingNotificationWithoutSnapshot) {
        log.info(this.cameraName, 'Empty snapshot will be sent on ring events immediately to speed up homekit notifications.');
      }
    } catch (err) {
      log.error(this.cameraName, 'could not cache black snapshot file for further use: ' + err);
    }

    this.fetchSnapshotFromCloud() // get current cloud snapshot for balanced mode scenarios -> first snapshot can be resolved
      .catch((err) => log.warn(this.cameraName,
        'snapshot handler is initialized without cloud snapshot. Maybe no snapshot will displayed the first times.' + err));
  }

  private onRingEvent(device: Device, state: boolean) {
    if (state) {
      log.debug(this.cameraName, 'Snapshot handler detected ring event.');
      this.lastRingEvent = Date.now();
    }
  }

  private async onMotionEvent(device: Device, state: boolean) {
    if (state) {
      log.debug(this.cameraName, 'Snapshot handler detected event.');
      this.lastEvent = Date.now();
    }
  }

  private async onPropertyValueChanged(device: Device, name: string): Promise<void> {
    if (name === 'picture') {
      this.lastImageEvent = Date.now();
      log.debug(this.cameraName, 'New picture event');
      this.fetchSnapshotFromCloud();
    }
  }

  public async getSnapshotBuffer(request: SnapshotRequest): Promise<Buffer> {
    const now = Date.now();
    let snapshot = SnapshotUnavailable;

    // Fetch snapshot based on handling method
    try {

      // Return a recent snapshot if available
      if (this.currentSnapshot && Math.abs((now - this.currentSnapshot.timestamp) / 1000) <= 15) {

        log.debug('Returning recent cached snapshot.');
        snapshot = this.currentSnapshot.image;

      } else if (this.cameraConfig.immediateRingNotificationWithoutSnapshot && (now - this.lastRingEvent) / 1000 < 5) {

        log.debug('Sending black snapshot to prioritize ring notification.');
        snapshot = SnapshotBlack;

      } else {

        switch (this.cameraConfig.snapshotHandlingMethod) {
          case 1:
            log.debug('Fetching the newest snapshot buffer.');
            snapshot = await this.getNewestSnapshotBuffer();
            break;
          case 2:
            log.debug('Fetching a balanced snapshot.');
            snapshot = await this.getBalancedSnapshot();
            break;
          case 3:
            log.debug('Fetching the newest cloud snapshot.');
            snapshot = await this.getNewestCloudSnapshot();
            break;
          default:
            log.debug('No suitable snapshot handling method defined.');
            return Promise.reject('No suitable handling method for snapshots defined');

        }
      }

    } catch (err) {
      log.error('Error fetching snapshot:', err);
      snapshot = SnapshotUnavailable;
    }

    return this.resizeSnapshot(snapshot, request);
  }

  /**
   * Attempts to resolve or reject the promise based on the current snapshot state.
   * @param resolve - The resolve function of the Promise.
   * @param reject - The reject function of the Promise.
   */
  private handleSnapshotResolution(resolve: (value: Buffer) => void, reject: (reason?: any) => void) {
    if (this.currentSnapshot) {
      resolve(this.currentSnapshot.image);
    } else {
      reject('No snapshot in memory');
    }
  }

  /**
   * Sets up a timeout for snapshot retrieval and handles the resolution or rejection.
   * @param resolve - The resolve function of the Promise.
   * @param reject - The reject function of the Promise.
   * @param timeout - The timeout duration in milliseconds.
   */
  private setupSnapshotTimeout(resolve: (value: Buffer) => void, reject: (reason?: any) => void, timeout: number): NodeJS.Timeout {
    return setTimeout(() => {
      this.handleSnapshotResolution(resolve, reject);
    }, timeout);
  }

  /**
   * Sets up an event listener for the 'new snapshot' event.
   * Clears the provided timeout and handles the snapshot resolution.
   * @param resolve - The resolve function of the Promise.
   * @param reject - The reject function of the Promise.
   * @param snapshotTimeout - The timeout object to clear.
   */
  private setupNewSnapshotListener(resolve: (value: Buffer) => void, reject: (reason?: any) => void, snapshotTimeout: NodeJS.Timeout) {
    this.once('new snapshot', () => {
      clearTimeout(snapshotTimeout);
      this.handleSnapshotResolution(resolve, reject);
    });
  }

  /**
   * Asynchronously retrieves the newest snapshot buffer from the camera.
   * Initiates a snapshot fetch request and waits for the snapshot to be available,
   * with a timeout to handle cases where the snapshot is not received promptly.
   * @returns {Promise<Buffer>} A promise that resolves with the latest snapshot image buffer
   *                            or rejects with an error message if the snapshot is not 
   *                            retrieved within the expected time frame.
   */
  private async getNewestSnapshotBuffer(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.fetchCurrentCameraSnapshot().catch((err) => reject(err));

      const requestTimeout = this.setupSnapshotTimeout(resolve, reject, EXTENDED_WAIT_MS);

      this.setupNewSnapshotListener(resolve, reject, requestTimeout);
    });
  }

  /**
   * Attempts to retrieve the newest snapshot from the cloud. If a new snapshot is not available
   * within a specified timeout, it either resolves with the current snapshot or rejects.
   * @returns {Promise<Buffer>} A promise that resolves with the newest snapshot.
   */
  private async getNewestCloudSnapshot(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const newestEvent = Math.max(this.lastRingEvent, this.lastEvent);
      const diffInSeconds = (Date.now() - newestEvent) / 1000;

      const snapshotTimeout = diffInSeconds < SNAPSHOT_WAIT_THRESHOLD_SECONDS
        ? this.setupSnapshotTimeout(resolve, reject, SNAPSHOT_WAIT_THRESHOLD_SECONDS * 1000)
        : this.setupSnapshotTimeout(resolve, reject, 0);

      this.setupNewSnapshotListener(resolve, reject, snapshotTimeout);
    });
  }

  /**
   * Retrieves a balanced snapshot by considering battery impact and data freshness.
   * This function attempts to fetch the newest snapshot, either from the camera or the cloud,
   * depending on the situation and timeout thresholds.
   * @returns {Promise<Buffer>} A promise that resolves with the balanced snapshot image buffer
   *                            or rejects with an error message if the snapshot is not 
   *                            retrieved within the expected time frame.
   */
  private async getBalancedSnapshot(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const newestEvent = Math.max(this.lastRingEvent, this.lastEvent);
      const diffInSeconds = (Date.now() - newestEvent) / 1000;

      // Check if the difference between events is less than the threshold
      if (diffInSeconds < SNAPSHOT_WAIT_THRESHOLD_SECONDS) {
        // If within the threshold, prioritize camera snapshot
        this.fetchCurrentCameraSnapshot().catch((err) => reject(err));
      }

      const snapshotTimeout = this.setupSnapshotTimeout(resolve, reject, 200);
      this.setupNewSnapshotListener(resolve, reject, snapshotTimeout);

    });
  }

  /**
   * Triggers an automatic refresh of the camera snapshot at intervals defined in the camera configuration.
   * If an error occurs during snapshot fetching, it logs a warning.
   */
  private automaticSnapshotRefresh() {
    log.debug(this.cameraName, 'Automatic snapshot refresh triggered.');

    this.fetchCurrentCameraSnapshot().catch((err) => {
      // Enhanced error logging
      log.warn(this.cameraName, 'Snapshot fetch error:', err);
    });

    // Clear existing timer if it exists
    if (this.snapshotRefreshTimer) {
      clearTimeout(this.snapshotRefreshTimer);
    }

    // Schedule the next snapshot refresh, if configured
    const refreshInterval = this.refreshSnapshotIntervalMinutes;
    if (refreshInterval) {
      this.snapshotRefreshTimer = setTimeout(() => {
        this.automaticSnapshotRefresh();
      }, refreshInterval * MILLISECONDS_PER_MINUTE);
    }
  }

  /**
   * Asynchronously retrieves a snapshot from the cloud.
   * If no previous snapshots are available, it sets the last and current snapshots to the fetched image.
   * @returns Promise<void>
   */
  private async fetchSnapshotFromCloud(): Promise<void> {
    try {
      const image = this.device.getPropertyValue(PropertyName.DevicePicture) as Picture;
      log.debug(this.cameraName, 'trying to download latest cloud snapshot for future use');
      if (!this.lastCloudSnapshot && !this.currentSnapshot) {
        this.lastCloudSnapshot = {
          timestamp: Date.now() - 60 * MILLISECONDS_PER_MINUTE, // An hour earlier
          image: image.data,
        };
        this.currentSnapshot = this.lastCloudSnapshot;
        log.debug(this.cameraName, 'Stored cloud snapshot for future use.');
        this.emit('new snapshot');
      }
      return Promise.resolve();
    } catch (err) {
      log.warn(this.cameraName, 'Couldt not get cloud snapshot: ' + err);
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
    log.debug(`${this.cameraName} Locked refresh process.`);
    log.debug(`${this.cameraName} Fetching new snapshot from camera.`);

    try {
      const snapshotBuffer = await this.getCurrentCameraSnapshot();

      log.debug(`${this.cameraName} Store new snapshot from camera in memory for future use.`);
      this.currentSnapshot = {
        timestamp: Date.now(),
        image: snapshotBuffer,
      };
      this.emit('new snapshot');
    } catch (err) {
      log.warn(`${this.cameraName} Error fetching snapshot: ${err}`);
      throw err;
    } finally {
      this.refreshProcessRunning = false;
      log.debug(`${this.cameraName} Unlocked refresh process.`);
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
    if (is_rtsp_ready(this.device, this.cameraConfig)) {
      const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
      log.debug(`${this.cameraName} RTSP URL: ${url}`);
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
      const ffmpeg = new FFmpeg(`[${this.cameraName}] [Snapshot Process]`, [parameters]);
      return await ffmpeg.getResult();
    } finally {
      if (source.livestreamId) {
        log.debug('STOP! Snapshot');
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
      log.error('Error resizing snapshot:', error);
      throw error;
    }
  }
}