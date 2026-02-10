import { Readable } from 'stream';
import * as fs from 'fs';

import { Camera, Device, DeviceEvents, Picture, PropertyName } from 'eufy-security-client';
import { SnapshotRequest } from 'homebridge';
import { ILogObj, Logger } from 'tslog';

import { CameraAccessory } from '../accessories/CameraAccessory';
import {
  SNAPSHOT_CACHE_BALANCED_SECONDS,
  SNAPSHOT_CACHE_FRESH_SECONDS,
  SNAPSHOT_CLOUD_SKIP_MS,
  SNAPSHOT_FETCH_TIMEOUT_MS,
  SNAPSHOT_MIN_REFRESH_INTERVAL_MINUTES,
  SNAPSHOT_RING_DEBOUNCE_SECONDS,
} from '../settings';
import { CameraConfig, SnapshotHandlingMethod } from '../utils/configTypes';
import { FFmpeg, FFmpegParameters } from '../utils/ffmpeg';
import { is_rtsp_ready } from '../utils/utils';
import { LocalLivestreamManager } from './LocalLivestreamManager';

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

type StreamSource =
  | { type: 'rtsp'; url: string }
  | { type: 'local'; stream: Readable };

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

export class snapshotDelegate {

  private static instanceCount = 0;

  private readonly eufyPath: string;
  private readonly device: Camera;
  private cameraConfig: CameraConfig;

  private currentSnapshot?: Snapshot;
  private readonly placeholders = new Map<PlaceholderKey, Buffer>();

  private pendingFetch?: Promise<void>;
  private lastRingEvent = 0;
  private isDeviceOffline = false;

  private readonly log: Logger<ILogObj>;

  private snapshotRefreshTimer?: NodeJS.Timeout;
  private snapshotRefreshInterval?: NodeJS.Timeout;

  constructor(
    camera: CameraAccessory,
    private livestreamManager: LocalLivestreamManager,
  ) {

    this.eufyPath = camera.platform.eufyPath;
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

    if (this.cameraConfig.refreshSnapshotIntervalMinutes < SNAPSHOT_MIN_REFRESH_INTERVAL_MINUTES) {
      this.log.warn(`The interval to automatically refresh snapshots is set too low. Minimum is ${SNAPSHOT_MIN_REFRESH_INTERVAL_MINUTES} minutes.`);
      this.cameraConfig.refreshSnapshotIntervalMinutes = SNAPSHOT_MIN_REFRESH_INTERVAL_MINUTES;
    }

    const intervalMs = this.cameraConfig.refreshSnapshotIntervalMinutes * 60 * 1000;
    const staggerMs = (++snapshotDelegate.instanceCount) * 60 * 1000;

    this.log.info(
      `Setting up automatic snapshot refresh every ${this.cameraConfig.refreshSnapshotIntervalMinutes}` +
      ` minutes. This may decrease battery life dramatically. First refresh in ~${Math.ceil(staggerMs / 60000)} minute(s).`,
    );

    // Stagger first refresh per instance, then repeat at fixed interval
    this.snapshotRefreshTimer = setTimeout(() => {
      this.doAutomaticRefresh();
      this.snapshotRefreshInterval = setInterval(() => this.doAutomaticRefresh(), intervalMs);
    }, staggerMs);
  }

  private doAutomaticRefresh(): void {
    this.log.debug('Automatic snapshot refresh triggered.');
    this.fetchCurrentCameraSnapshot().catch((error) => this.log.warn('Automatic snapshot refresh failed:', error));
  }

  private logSnapshotHandlingMethod(): void {
    const method = this.cameraConfig.snapshotHandlingMethod;

    switch (method) {
      case SnapshotHandlingMethod.AlwaysFresh:
        this.log.info('is set to generate new snapshots on events every time. This might reduce homebridge performance and increase power consumption.');
        if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
          this.log.warn('You have enabled automatic snapshot refreshing. It is recommended not to use this setting with forced snapshot refreshing.');
        }
        break;
      case SnapshotHandlingMethod.Balanced:
        this.log.info('is set to balanced snapshot handling.');
        break;
      case SnapshotHandlingMethod.CloudOnly:
        this.log.info('is set to handle snapshots with cloud images. Snapshots might be older than they appear.');
        break;
      default:
        this.log.warn('unknown snapshot handling method. Snapshots will not be generated.');
    }

    if (this.cameraConfig.immediateRingNotificationWithoutSnapshot) {
      this.log.info('Empty snapshot will be sent on ring events immediately to speed up homekit notifications.');
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
        return;
      }
    } catch (error) {
      this.log.debug('Could not fetch snapshot from device property: ' + error);
    }

    // Fallback: try to load a previously cached snapshot from disk
    this.loadSnapshotFromDisk();
  }

  private loadSnapshotFromDisk(): void {
    const serial = this.device.getSerial();
    const extensions = ['jpg', 'png', 'bmp'];

    for (const ext of extensions) {
      const filePath = `${this.eufyPath}/${serial}.${ext}`;
      try {
        if (fs.existsSync(filePath)) {
          const data = fs.readFileSync(filePath);
          if (data.length > 0) {
            const mtime = fs.statSync(filePath).mtimeMs;
            this.storeSnapshotForCache(data, mtime);
            this.log.info(`Loaded cached snapshot from disk: ${filePath}`);
            return;
          }
        }
      } catch (error) {
        this.log.debug(`Failed to load snapshot from ${filePath}: ${error}`);
      }
    }

    this.log.warn('No cached snapshot found on disk for device ' + serial);
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
    if (!this.device.isEnabled()) {
      this.log.debug('Device is disabled, returning disabled snapshot.');
      return this.getPlaceholder('disabled');
    }

    if (this.isDeviceOffline) {
      this.log.debug('Device is offline, returning offline snapshot.');
      return this.getPlaceholder('offline');
    }

    if (this.isCacheFresh(SNAPSHOT_CACHE_FRESH_SECONDS)) {
      return this.currentSnapshot!.image;
    }

    const ringAge = (Date.now() - this.lastRingEvent) / 1000;
    if (this.cameraConfig.immediateRingNotificationWithoutSnapshot && ringAge < SNAPSHOT_RING_DEBOUNCE_SECONDS) {
      this.log.debug('Sending empty snapshot to speed up homekit notification for ring event.');
      return this.getPlaceholder('black');
    }

    return this.resolveByHandlingMethod();
  }

  private async resolveByHandlingMethod(): Promise<Buffer> {
    try {
      switch (this.cameraConfig.snapshotHandlingMethod) {
        case SnapshotHandlingMethod.AlwaysFresh:
          return await this.fetchSnapshotFromStream();

        case SnapshotHandlingMethod.Balanced:
          if (this.isCacheFresh(SNAPSHOT_CACHE_BALANCED_SECONDS)) {
            return this.currentSnapshot!.image;
          }
          return await this.fetchSnapshotFromStream();

        case SnapshotHandlingMethod.CloudOnly:
          return this.getCachedOrPlaceholder();

        default:
          throw new Error('No suitable handling method for snapshots defined');
      }
    } catch (err) {
      this.log.warn('Snapshot retrieval failed, falling back to cache:', err);
      return this.getCachedOrPlaceholder();
    }
  }

  /**
   * Fetches a fresh snapshot from a live stream.
   */
  private async fetchSnapshotFromStream(): Promise<Buffer> {
    this.log.info('Begin live streaming to access the most recent snapshot (significant battery drain on the device)');
    await this.fetchCurrentCameraSnapshot();

    if (this.currentSnapshot) {
      return this.currentSnapshot.image;
    }
    throw new Error('Snapshot fetch completed but no snapshot stored');
  }

  /**
   * Returns cached snapshot or the unavailable placeholder.
   */
  private getCachedOrPlaceholder(): Buffer {
    if (this.currentSnapshot) {
      return this.currentSnapshot.image;
    }
    this.log.warn('No currentSnapshot available, using fallback unavailable snapshot image');
    return this.getPlaceholder('unavailable');
  }

  private isCacheFresh(maxAgeSeconds: number): boolean {
    return !!this.currentSnapshot &&
      (Date.now() - this.currentSnapshot.timestamp) / 1000 <= maxAgeSeconds;
  }

  private storeImage(file: string, image: Buffer) {
    const filePath = `${this.eufyPath}/${file}`;
    try {
      fs.writeFileSync(filePath, image);
      this.log.debug(`Stored Image: ${filePath}`);
    } catch (error) {
      this.log.warn(`Failed to store image: ${filePath} - ${error}`);
    }
  }

  private async onPropertyValueChanged(device: Device, name: string): Promise<void> {
    switch (name) {
      case 'picture': {
        const picture = device.getPropertyValue(PropertyName.DevicePicture) as Picture;
        if (picture && picture.type) {
          this.storeImage(`${device.getSerial()}.${picture.type.ext}`, picture.data);
          if (this.currentSnapshot && (Date.now() - this.currentSnapshot.timestamp) < SNAPSHOT_CLOUD_SKIP_MS) {
            this.log.debug('Skipping cloud snapshot update, a recent stream snapshot already exists.');
          } else {
            this.storeSnapshotForCache(picture.data);
          }
        }
        break;
      }

      case 'enabled': {
        const enabled = device.getPropertyValue(PropertyName.DeviceEnabled) as boolean;
        this.log.info(`Device enabled state changed to: ${enabled}`);
        if (enabled) {
          this.currentSnapshot = undefined;
        }
        break;
      }

      case 'state': {
        const state = device.getPropertyValue(PropertyName.DeviceState) as number;
        const wasOffline = this.isDeviceOffline;
        this.isDeviceOffline = (state === 0 || state === 3);
        if (this.isDeviceOffline && !wasOffline) {
          this.log.warn(`Device went offline (state: ${state}).`);
        } else if (!this.isDeviceOffline && wasOffline) {
          this.log.info(`Device came back online (state: ${state}).`);
          this.currentSnapshot = undefined;
        }
        break;
      }
    }
  }

  /**
   * Fetches a snapshot from the camera, stores it in cache, and deduplicates concurrent calls.
   */
  private async fetchCurrentCameraSnapshot(): Promise<void> {
    if (this.pendingFetch) {
      return this.pendingFetch;
    }

    this.log.debug('Fetching new snapshot from camera.');

    this.pendingFetch = this.withTimeout((async () => {
      const source = await this.getCameraSource();

      const isLocalStream = source.type === 'local';
      try {
        const buffer = await this.runFFmpegSnapshot('[Snapshot Process]', async (params) => {
          if (source.type === 'rtsp') {
            params.setInputSource(source.url);
          } else {
            await params.setInputStream(source.stream);
          }
          if (this.cameraConfig.delayCameraSnapshot) {
            params.setDelayedSnapshot();
          }
        });
        this.storeSnapshotForCache(buffer);
      } finally {
        if (isLocalStream) {
          this.livestreamManager.stopLocalLiveStream();
        }
      }
    })(), SNAPSHOT_FETCH_TIMEOUT_MS).finally(() => {
      this.pendingFetch = undefined;
    });

    return this.pendingFetch;
  }

  private async getCameraSource(): Promise<StreamSource> {
    if (is_rtsp_ready(this.device, this.cameraConfig)) {
      const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) as string;
      this.log.debug('RTSP URL: ' + url);
      return { type: 'rtsp', url };
    }

    const streamData = await this.livestreamManager.getLocalLivestream();
    return { type: 'local', stream: streamData.videostream };
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Snapshot fetch timed out after ${ms}ms`)), ms);
      promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }

  private async resizeSnapshot(snapshot: Buffer, request: SnapshotRequest): Promise<Buffer> {
    return this.runFFmpegSnapshot('[Snapshot Resize]', (params) => {
      params.setup(this.cameraConfig, request);
    }, snapshot);
  }

  private async runFFmpegSnapshot(
    label: string,
    configure: (params: FFmpegParameters) => void | Promise<void>,
    input?: Buffer,
  ): Promise<Buffer> {
    const params = await FFmpegParameters.forSnapshot(this.cameraConfig.videoConfig?.debug);
    await configure(params);
    return new FFmpeg(label, params).getResult(input);
  }
}