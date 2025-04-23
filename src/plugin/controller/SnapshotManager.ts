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
import { PROTECT_SNAPSHOT_CACHE_MAXAGE } from '../settings';

const CameraOffline = require.resolve('../../media/camera-offline.png');
const CameraDisabled = require.resolve('../../media/camera-disabled.png');
const SnapshotBlackPath = require.resolve('../../media/Snapshot-black.png');
const SnapshotUnavailable = require.resolve('../../media/Snapshot-Unavailable.png');

// Used to stagger automatic refresh start times across multiple devices
let MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN = 1;

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
 * SnapshotManager handles obtaining and caching camera snapshots
 * with three performance modes:
 * 1. Always refresh (battery intensive)
 * 2. Balanced approach (refresh when needed)
 * 3. Cache-first (lowest battery impact)
 */
export class SnapshotManager extends EventEmitter {
  private readonly platform: EufySecurityPlatform;
  private readonly device: Camera;
  private cameraConfig: CameraConfig;

  // Cached snapshot and fallback images
  private currentSnapshot?: Snapshot;
  private fallbackImages = new Map<string, Buffer>();
  
  private refreshProcessRunning = false;
  private lastEvent = 0;
  private lastRingEvent = 0;
  private snapshotRefreshTimer?: NodeJS.Timeout;

  public readonly log: Logger<ILogObj>;

  constructor(
    camera: CameraAccessory,
    private livestreamManager: LocalLivestreamManager,
  ) {
    super();

    this.platform = camera.platform;
    this.device = camera.device;
    this.cameraConfig = camera.cameraConfig;
    this.log = camera.log;

    // Initialize event listeners
    this.initEventListeners();
    
    // Initialize snapshot refresh timer if configured
    this.initRefreshTimer();
    
    // Load fallback images
    this.loadFallbackImages();

    // Try to get initial snapshot from device
    this.loadInitialSnapshot();
  }

  /**
   * Initialize event listeners for device events
   */
  private initEventListeners(): void {
    this.device.on('property changed', this.onPropertyValueChanged.bind(this));

    // Register for all event types that might trigger snapshot updates
    const eventTypes: (keyof DeviceEvents)[] = [
      'motion detected', 'person detected', 'pet detected', 
      'sound detected', 'crying detected', 'vehicle detected',
      'dog detected', 'dog lick detected', 'dog poop detected',
      'stranger person detected'
    ];

    eventTypes.forEach(eventType => {
      this.device.on(eventType, this.onEvent.bind(this));
    });

    this.device.on('rings', this.onRingEvent.bind(this));
  }

  /**
   * Initialize automatic snapshot refresh timer if configured
   */
  private initRefreshTimer(): void {
    if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
      // Enforce minimum refresh interval
      if (this.cameraConfig.refreshSnapshotIntervalMinutes < 5) {
        this.log.warn('The interval to automatically refresh snapshots is set too low. Minimum is 5 minutes.');
        this.cameraConfig.refreshSnapshotIntervalMinutes = 5;
      }

      this.log.info(
        `Setting up automatic snapshot refresh every ${this.cameraConfig.refreshSnapshotIntervalMinutes} minutes. ` +
        `This may decrease battery life dramatically. The refresh process will begin in ` +
        `${MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN} minutes.`
      );

      // Stagger startup to avoid all devices refreshing simultaneously
      setTimeout(
        () => this.automaticSnapshotRefresh(),
        MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN * 60 * 1000
      );
      
      MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN++;
    }

    // Log snapshot handling mode
    this.logSnapshotHandlingMode();
  }

  /**
   * Log information about the configured snapshot handling mode
   */
  private logSnapshotHandlingMode(): void {
    switch (this.cameraConfig.snapshotHandlingMethod) {
      case 1:
        this.log.info('Set to generate new snapshots on events every time. This might reduce performance and increase power consumption.');
        if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
          this.log.warn('You have enabled automatic snapshot refreshing. It is not recommended to use this setting with forced snapshot refreshing.');
        }
        break;
      case 2:
        this.log.info('Set to balanced snapshot handling.');
        break;
      case 3:
        this.log.info('Set to handle snapshots with cloud images. Snapshots might be older than they appear.');
        break;
      default:
        this.log.warn('Unknown snapshot handling method. Snapshots will not be generated.');
    }
  }

  /**
   * Load and cache fallback images
   */
  private loadFallbackImages(): void {
    const imagePaths = {
      'black': SnapshotBlackPath,
      'unavailable': SnapshotUnavailable,
      'offline': CameraOffline,
      'disabled': CameraDisabled
    };

    Object.entries(imagePaths).forEach(([key, path]) => {
      try {
        this.fallbackImages.set(key, fs.readFileSync(path));
        if (key === 'black' && this.cameraConfig.immediateRingNotificationWithoutSnapshot) {
          this.log.info('Empty snapshot will be sent on ring events immediately to speed up homekit notifications.');
        }
      } catch (error) {
        this.log.error(`Could not cache ${key} snapshot file: ${error}`);
      }
    });
  }

  /**
   * Try to load initial snapshot from device
   */
  private loadInitialSnapshot(): void {
    try {
      const picture = this.device.getPropertyValue(PropertyName.DevicePicture) as Picture;
      if (picture && picture.type) {
        this.storeSnapshotForCache(picture.data, 0);
      } else {
        throw new Error('No initial snapshot available');
      }
    } catch (error) {
      this.log.error(`Could not fetch initial snapshot: ${error}`);
    }
  }

  /**
   * Handle ring events
   */
  private onRingEvent(device: Device, state: boolean) {
    if (state) {
      this.log.debug('Snapshot handler detected ring event.');
      this.lastRingEvent = Date.now();
    }
  }

  /**
   * Handle generic device events
   */
  private onEvent(device: Device, state: boolean) {
    if (state) {
      this.log.debug('Snapshot handler detected event.');
      this.lastEvent = Date.now();
    }
  }

  /**
   * Store snapshot data in cache
   */
  private storeSnapshotForCache(data: Buffer, time?: number): void {
    this.currentSnapshot = { timestamp: time ?? Date.now(), image: data };
  }

  /**
   * Public method to get a resized snapshot
   */
  public async getSnapshotBufferResized(request: SnapshotRequest): Promise<Buffer> {
    return this.resizeSnapshot(await this.getSnapshotBuffer(), request);
  }

  /**
   * Get snapshot buffer using the configured handling method
   */
  private async getSnapshotBuffer(): Promise<Buffer> {
    // Check if camera is disabled
    if (!this.device.isEnabled()) {
      const disabledImage = this.fallbackImages.get('disabled');
      if (disabledImage) return disabledImage;
      return Promise.reject('Camera is disabled and fallback image unavailable');
    }

    // Check for recent ring event - may need immediate response
    if (this.shouldSendImmediateRingNotification()) {
      const blackImage = this.fallbackImages.get('black');
      if (blackImage) return blackImage;
      return Promise.reject('Prioritizing ring notification but empty snapshot unavailable');
    }

    // Check for recent valid snapshot in cache
    if (this.hasRecentSnapshotInCache(15)) {
      return this.currentSnapshot!.image;
    }

    try {
      // Use configured handling method to get snapshot
      switch (this.cameraConfig.snapshotHandlingMethod) {
        case 1: // Always refresh
          return await this.getSnapshotFromStream();
        case 2: // Balanced approach
          return await this.getBalancedSnapshot();
        case 3: // Cache-first approach
          return this.getSnapshotFromCache();
        default:
          return Promise.reject('No suitable snapshot handling method defined');
      }
    } catch (error) {
      // Fallback to cache, then fallback image
      try {
        return this.getSnapshotFromCache();
      } catch (innerError) {
        this.log.error(innerError);
        const unavailableImage = this.fallbackImages.get('unavailable');
        if (unavailableImage) return unavailableImage;
        throw error;
      }
    }
  }

  /**
   * Check if we should send an immediate black image for ring notification
   */
  private shouldSendImmediateRingNotification(): boolean {
    if (!this.cameraConfig.immediateRingNotificationWithoutSnapshot) return false;
    
    const secondsSinceRing = (Date.now() - this.lastRingEvent) / 1000;
    return secondsSinceRing < 5;
  }

  /**
   * Check if we have a recent snapshot in cache
   */
  private hasRecentSnapshotInCache(maxAgeSeconds: number): boolean {
    if (!this.currentSnapshot) return false;
    
    const diff = Math.abs((Date.now() - this.currentSnapshot.timestamp) / 1000);
    return diff <= maxAgeSeconds;
  }

  /**
   * Get snapshot from live stream
   */
  private getSnapshotFromStream(): Promise<Buffer> {
    this.log.info('Begin live streaming to access the most recent snapshot (battery drain warning)');
    
    return new Promise((resolve, reject) => {
      const requestTimeout = setTimeout(() => {
        reject('Snapshot request timed out');
      }, 4000);

      const snapshotListener = () => {
        clearTimeout(requestTimeout);
        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image);
        } else {
          reject('Error retrieving snapshot');
        }
      };

      this.fetchCurrentCameraSnapshot()
        .then(() => this.once('new snapshot', snapshotListener))
        .catch(error => {
          clearTimeout(requestTimeout);
          reject(error);
        });
    });
  }

  /**
   * Get snapshot from cache with fallback handling
   */
  private getSnapshotFromCache(): Buffer {
    if (this.currentSnapshot) {
      return this.currentSnapshot.image;
    }
    
    const unavailableImage = this.fallbackImages.get('unavailable');
    if (unavailableImage) {
      this.log.warn('No snapshot in cache, using fallback unavailable image');
      return unavailableImage;
    }
    
    throw new Error('No snapshot available');
  }

  /**
   * Get snapshot using the balanced approach
   */
  private async getBalancedSnapshot(): Promise<Buffer> {
    if (this.hasRecentSnapshotInCache(30)) {
      return this.currentSnapshot!.image;
    }
    
    return this.getSnapshotFromStream();
  }

  /**
   * Trigger automated snapshot refresh
   */
  private automaticSnapshotRefresh(): void {
    this.log.debug('Automatic snapshot refresh triggered');
    
    this.fetchCurrentCameraSnapshot()
      .catch(error => this.log.warn(`Automatic refresh failed: ${error}`));
    
    // Schedule next refresh
    if (this.snapshotRefreshTimer) {
      clearTimeout(this.snapshotRefreshTimer);
    }
    
    if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
      this.snapshotRefreshTimer = setTimeout(
        () => this.automaticSnapshotRefresh(),
        this.cameraConfig.refreshSnapshotIntervalMinutes * 60 * 1000
      );
    }
  }

  /**
   * Store image to disk
   */
  private storeImage(file: string, image: Buffer): void {
    const filePath = `${this.platform.eufyPath}/${file}`;
    try {
      fs.writeFileSync(filePath, image);
      this.log.debug(`Stored image: ${filePath}`);
    } catch (error) {
      this.log.debug(`Error storing image: ${filePath} - ${error}`);
    }
  }

  /**
   * Handle property value changes from the device
   */
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

  /**
   * Fetch current camera snapshot
   */
  private async fetchCurrentCameraSnapshot(): Promise<void> {
    if (this.refreshProcessRunning) {
      return Promise.resolve();
    }
    
    this.refreshProcessRunning = true;
    this.log.debug('Fetching new snapshot from camera');
    
    try {
      const snapshotBuffer = await this.getCurrentCameraSnapshot();
      this.storeSnapshotForCache(snapshotBuffer);
      this.emit('new snapshot');
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(`Failed to get camera snapshot: ${error}`);
    } finally {
      this.refreshProcessRunning = false;
    }
  }

  /**
   * Get current camera snapshot from source
   */
  private async getCurrentCameraSnapshot(): Promise<Buffer> {
    const source = await this.getCameraSource();
    if (!source) {
      return Promise.reject('No camera source detected');
    }

    const parameters = await FFmpegParameters.forSnapshot(this.cameraConfig.videoConfig?.debug);
    
    if (source.url) {
      parameters.setInputSource(source.url);
    } else if (source.stream) {
      await parameters.setInputStream(source.stream);
    } else {
      return Promise.reject('No valid camera source detected');
    }

    if (this.cameraConfig.delayCameraSnapshot) {
      parameters.setDelayedSnapshot();
    }

    try {
      const ffmpeg = new FFmpeg('[Snapshot Process]', parameters);
      const buffer = await ffmpeg.getResult();
      return buffer;
    } catch (error) {
      return Promise.reject(error);
    } finally {
      this.livestreamManager.stopLocalLiveStream();
    }
  }

  /**
   * Get camera source (RTSP URL or livestream)
   */
  private async getCameraSource(): Promise<StreamSource | null> {
    // Try RTSP first if available
    if (is_rtsp_ready(this.device, this.cameraConfig)) {
      try {
        const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
        this.log.debug(`RTSP URL: ${url}`);
        return { url: url as string };
      } catch (error) {
        this.log.warn('Could not get snapshot from RTSP stream', error);
      }
    }
    
    // Fall back to livestream
    try {
      const streamData = await this.livestreamManager.getLocalLivestream();
      return { stream: streamData.videostream };
    } catch (error) {
      this.log.warn('Could not get snapshot from livestream', error);
      return null;
    }
  }

  /**
   * Resize snapshot if needed
   */
  private async resizeSnapshot(snapshot: Buffer, request: SnapshotRequest): Promise<Buffer> {
    // Skip resize if no configuration exists
    if (!this.cameraConfig.videoConfig || 
        (!this.cameraConfig.videoConfig.maxWidth && 
         !this.cameraConfig.videoConfig.maxHeight && 
         !this.cameraConfig.videoConfig.videoFilter)) {
      return snapshot;
    }

    try {
      // Create FFmpeg parameters for snapshot resizing
      const parameters = await FFmpegParameters.forSnapshot(this.cameraConfig.videoConfig?.debug);
      
      // Explicitly set dimensions from request if not specified in config
      if (!this.cameraConfig.videoConfig.maxWidth && !this.cameraConfig.videoConfig.maxHeight) {
        parameters.setResolution(request.width, request.height);
      }
      
      // Apply camera configuration and request parameters
      parameters.setup(this.cameraConfig, request);
      
      // Process the snapshot with FFmpeg
      const ffmpeg = new FFmpeg('[Snapshot Resize Process]', parameters);
      return ffmpeg.getResult(snapshot);
    } catch (error) {
      this.log.error(`Error resizing snapshot: ${error}`);
      // Return original snapshot if resize fails
      return snapshot;
    }
  }
}