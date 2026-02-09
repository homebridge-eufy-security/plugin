import { Readable } from 'stream';

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

type PlaceholderKey = 'black' | 'unavailable' | 'offline' | 'disabled';

const PLACEHOLDER_PATHS: Record<PlaceholderKey, string> = {
  offline: require.resolve('../../media/camera-offline.png'),
  disabled: require.resolve('../../media/camera-disabled.png'),
  black: require.resolve('../../media/Snapshot-black.png'),
  unavailable: require.resolve('../../media/Snapshot-Unavailable.png'),
};

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

export class SnapshotManager {

  private static instanceCount = 0;

  private readonly platform: EufySecurityPlatform;
  private readonly device: Camera;
  private cameraConfig: CameraConfig;

  private currentSnapshot?: Snapshot;
  private readonly placeholders = new Map<PlaceholderKey, Buffer>();

  private pendingFetch?: Promise<void>;
  private lastRingEvent = 0;
  private isDeviceOffline = false;

  public readonly log: Logger<ILogObj>;

  private snapshotRefreshTimer?: NodeJS.Timeout;

  constructor(
    camera: CameraAccessory,
    private livestreamManager: LocalLivestreamManager,
  ) {

    this.platform = camera.platform;
    this.device = camera.device;
    this.cameraConfig = camera.cameraConfig;
    this.log = camera.log;

    this.setupEventListeners();
    this.setupAutomaticRefresh();
    this.logSnapshotHandlingMethod();
    this.loadPlaceholderImages();
    this.initializeDeviceState();
    this.loadInitialSnapshot();
  }

  private setupEventListeners(): void {
    this.device.on('property changed', this.onPropertyValueChanged.bind(this));

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
  }

  private setupAutomaticRefresh(): void {
    if (!this.cameraConfig.refreshSnapshotIntervalMinutes) {
      return;
    }

    if (this.cameraConfig.refreshSnapshotIntervalMinutes < 5) {
      this.log.warn('The interval to automatically refresh snapshots is set too low. Minimum is 5 minutes.');
      this.cameraConfig.refreshSnapshotIntervalMinutes = 5;
    }

    const delayMinutes = ++SnapshotManager.instanceCount;

    this.log.info(
      'Setting up automatic snapshot refresh every ' + this.cameraConfig.refreshSnapshotIntervalMinutes +
      ' minutes. This may decrease battery life dramatically. The refresh process should begin in ' +
      delayMinutes + ' minutes.',
    );

    setTimeout(() => {
      this.automaticSnapshotRefresh();
    }, delayMinutes * 60 * 1000);
  }

  private logSnapshotHandlingMethod(): void {
    if (this.cameraConfig.snapshotHandlingMethod === 1) {
      this.log.info('is set to generate new snapshots on events every time. This might reduce homebridge performance and increase power consumption.');
      if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
        this.log.warn('You have enabled automatic snapshot refreshing. It is recommended not to use this setting with forced snapshot refreshing.');
      }
    } else if (this.cameraConfig.snapshotHandlingMethod === 2) {
      this.log.info('is set to balanced snapshot handling.');
    } else if (this.cameraConfig.snapshotHandlingMethod === 3) {
      this.log.info('is set to handle snapshots with cloud images. Snapshots might be older than they appear.');
    } else {
      this.log.warn('unknown snapshot handling method. Snapshots will not be generated.');
    }
  }

  private loadPlaceholderImages(): void {
    for (const [key, path] of Object.entries(PLACEHOLDER_PATHS) as [PlaceholderKey, string][]) {
      try {
        this.placeholders.set(key, fs.readFileSync(path));
      } catch (error) {
        this.log.error(`Could not cache ${key} placeholder for further use: ${error}`);
      }
    }

    if (this.cameraConfig.immediateRingNotificationWithoutSnapshot && this.placeholders.has('black')) {
      this.log.info('Empty snapshot will be sent on ring events immediately to speed up homekit notifications.');
    }
  }

  private getPlaceholder(key: PlaceholderKey): Buffer {
    const buf = this.placeholders.get(key);
    if (!buf) {
      throw new Error(`Placeholder image '${key}' is not available.`);
    }
    return buf;
  }

  private initializeDeviceState(): void {
    try {
      const state = this.device.getPropertyValue(PropertyName.DeviceState) as number;
      this.isDeviceOffline = (state === 0 || state === 3);
      if (this.isDeviceOffline) {
        this.log.info('Device is currently offline (state: ' + state + ').');
      }
    } catch (error) {
      this.log.debug('Could not read initial device state: ' + error);
    }
  }

  private loadInitialSnapshot(): void {
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
      return this.getPlaceholder('disabled');
    }

    if (this.isDeviceOffline) {
      this.log.debug('Device is offline, returning offline snapshot.');
      return this.getPlaceholder('offline');
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
      return this.getPlaceholder('black');
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
        throw new Error('No suitable handling method for snapshots defined');
      }
      return snapshot;

    } catch (err) {
      this.log.warn('Snapshot retrieval failed, falling back to cache:', err);
      try {
        return this.getSnapshotFromCache();
      } catch (error) {
        this.log.error(error);
        return this.getPlaceholder('unavailable');
      }
    }
  }

  /**
   * Retrieves the newest snapshot by awaiting the in-flight or new fetch.
   */
  private async getSnapshotFromStream(): Promise<Buffer> {
    this.log.info('Begin live streaming to access the most recent snapshot (significant battery drain on the device)');

    await this.fetchCurrentCameraSnapshot();

    if (this.currentSnapshot) {
      return this.currentSnapshot.image;
    }
    throw new Error('Snapshot fetch completed but no snapshot stored');
  }

  /**
   * Retrieves the newest cloud snapshot's image data.
   * @returns Buffer The image data as a Buffer.
   * @throws Error if there's no currentSnapshot available and no fallback image.
   */
  private getSnapshotFromCache(): Buffer {
    if (this.currentSnapshot) {
      return this.currentSnapshot.image;
    }

    this.log.warn('No currentSnapshot available, using fallback unavailable snapshot image');
    return this.getPlaceholder('unavailable');
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
      this.log.warn(`Failed to store image: ${filePath} - ${error}`);
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

    if (name === 'state') {
      const state = device.getPropertyValue(PropertyName.DeviceState) as number;
      const wasOffline = this.isDeviceOffline;
      this.isDeviceOffline = (state === 0 || state === 3);
      if (this.isDeviceOffline && !wasOffline) {
        this.log.warn(`Device went offline (state: ${state}).`);
      } else if (!this.isDeviceOffline && wasOffline) {
        this.log.info(`Device came back online (state: ${state}).`);
        this.currentSnapshot = undefined;
      }
    }
  }

  private async fetchCurrentCameraSnapshot(): Promise<void> {
    if (this.pendingFetch) {
      return this.pendingFetch;
    }

    this.log.debug('Fetching new snapshot from camera.');

    this.pendingFetch = this.getCurrentCameraSnapshot()
      .then((snapshotBuffer) => {
        this.storeSnapshotForCache(snapshotBuffer);
      })
      .finally(() => {
        this.pendingFetch = undefined;
      });

    return this.pendingFetch;
  }

  private async getCurrentCameraSnapshot(): Promise<Buffer> {
    const source = await this.getCameraSource();

    if (!source) {
      throw new Error('No camera source detected.');
    }

    const parameters = await FFmpegParameters.forSnapshot(this.cameraConfig.videoConfig?.debug);

    if (source.url) {
      parameters.setInputSource(source.url);
    } else if (source.stream) {
      await parameters.setInputStream(source.stream);
    } else {
      throw new Error('No valid camera source detected.');
    }

    if (this.cameraConfig.delayCameraSnapshot) {
      parameters.setDelayedSnapshot();
    }

    const isLocalStream = !!source.stream;

    try {
      const ffmpeg = new FFmpeg(
        `[Snapshot Process]`,
        parameters,
      );
      const buffer = await ffmpeg.getResult();

      if (isLocalStream) {
        this.livestreamManager.stopLocalLiveStream();
      }

      return buffer;
    } catch (error) {
      if (isLocalStream) {
        this.livestreamManager.stopLocalLiveStream();
      }
      throw error;
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