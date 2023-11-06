import { EventEmitter, Readable } from 'stream';

import { Camera, Device, DeviceEvents, Picture, PropertyName, PropertyValue } from 'eufy-security-client';

import { CameraConfig } from '../utils/configTypes';
import { EufySecurityPlatform } from '../platform';
import { LocalLivestreamManager } from './LocalLivestreamManager';
import { Logger as TsLogger, ILogObj } from 'tslog';

import { SnapshotRequest } from 'homebridge';
import * as fs from 'fs';
import { CameraAccessory } from '../accessories/CameraAccessory';

import sharp from 'sharp';

const SNAPSHOT_TIMEOUT = 15000;
let MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN = 1;

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

export class SnapshotManager extends EventEmitter {

  private readonly platform: EufySecurityPlatform = this.camera.platform;
  private readonly device: Camera = this.camera.device;
  private readonly log: TsLogger<ILogObj> = this.platform.log;
  private readonly cameraName: string = this.device.getName();
  private cameraConfig: CameraConfig = this.camera.cameraConfig;

  private currentSnapshot?: Snapshot;

  private refreshProcessRunning = false;
  private lastEvent = 0;
  private lastRingEvent = 0;
  private snapshotRefreshTimer?: NodeJS.Timeout;

  // List of event types
  private eventTypesToHandle: (keyof DeviceEvents)[] = [
    'motion detected',
    'person detected',
    'pet detected',
    'vehicle detected',
    'sound detected',
    'crying detected',
    'dog detected',
    'stranger person detected',
    'rings',
  ];

  constructor(
    private readonly camera: CameraAccessory,
    private livestreamManager: LocalLivestreamManager,
  ) {
    super();
    this.setupDeviceEventListeners();
    this.initializeSnapshotRefresh();
  }

  private setupDeviceEventListeners() {
    this.device.on('property changed', (device: Device, name: string, value: PropertyValue) =>
      this.onPropertyValueChanged(device, name, value),
    );

    this.eventTypesToHandle.forEach((event) => this.device.on(event, (device, state) => this.onEvent(device, state, event)));
  }

  private initializeSnapshotRefresh() {
    if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
      if (this.cameraConfig.refreshSnapshotIntervalMinutes < 5) {
        this.log.warn(`${this.cameraName} The interval to automatically refresh snapshots is set too low. Minimum is one minute.`);
        this.cameraConfig.refreshSnapshotIntervalMinutes = 5;
      }

      this.log.info(`${this.cameraName} Setting up automatic snapshot refresh 
      every ${this.cameraConfig.refreshSnapshotIntervalMinutes} minutes.
      This may decrease battery life dramatically. The refresh process for ${this.cameraName} should 
      begin in ${MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN} minutes.`);

      setTimeout(() => {
        this.automaticSnapshotRefresh();
      }, MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN * 60 * 1000);

      MINUTES_TO_WAIT_FOR_AUTOMATIC_REFRESH_TO_BEGIN++;
    }

    switch (this.cameraConfig.snapshotHandlingMethod) {
      case 1:
        this.log.info(`${this.cameraName} is set to generate new snapshots on events every time. 
        This might reduce homebridge performance and increase power consumption.`);
        if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
          this.log.warn(`${this.cameraName} You have enabled automatic snapshot refreshing. 
          It is recommended not to use this setting with forced snapshot refreshing.`);
        }
        break;
      case 2:
        this.log.info(`${this.cameraName} is set to balanced snapshot handling.`);
        break;
      case 3:
        this.log.info(`${this.cameraName} is set to handle snapshots with cloud images. 
        Snapshots might be older than they appear.`);
        break;
      default:
        this.log.warn(`${this.cameraName} unknown snapshot handling method. 
        Snapshots will not be generated.`);
        break;
    }

    if (this.cameraConfig.immediateRingNotificationWithoutSnapshot) {
      this.log.info(`${this.cameraName} Empty snapshot will be sent on ring events immediately to speed up homekit notifications.`);
    }
  }

  private onEvent(device: Device, state: boolean, eventType: string) {
    if (state) {
      this.log.debug(`${this.cameraName} Snapshot handler detected ${eventType}.`);
      this.lastEvent = Date.now();
    }
  }

  public async getSnapshotBuffer(request: SnapshotRequest): Promise<Buffer> {
    // Check if the current snapshot is recent enough (not more than 15 seconds old)
    if (this.currentSnapshot) {
      const diff = Math.abs((Date.now() - this.currentSnapshot.timestamp) / 1000);
      if (diff <= 15) {
        return this.resizeSnapshot(this.currentSnapshot.image, request);
      }
    }

    // Check if a ring event occurred recently (within the last 5 seconds)
    const ringEventDiff = (Date.now() - this.lastRingEvent) / 1000;
    if (this.cameraConfig.immediateRingNotificationWithoutSnapshot && ringEventDiff < 5) {
      this.log.debug(`${this.cameraName} Sending empty snapshot to speed up homekit notification for ring event.`);
      if (this.platform.blackSnapshot) {
        return this.resizeSnapshot(this.platform.blackSnapshot, request);
      } else {
        throw new Error('Could not supply empty snapshot for ring event.');
      }
    }

    // Handle snapshot based on the configured handling method
    let snapshot: Buffer;

    switch (this.cameraConfig.snapshotHandlingMethod) {
      case 1:
        snapshot = await this.getNewestSnapshotBuffer();
        break;
      case 2:
        snapshot = await this.getBalancedSnapshot();
        break;
      case 3:
        snapshot = await this.getNewestCloudSnapshot();
        break;
      default:
        throw new Error('No suitable handling method for snapshots defined.');
    }
    return this.resizeSnapshot(snapshot, request);
  }

  /**
   * Get the newest snapshot buffer.
   * @returns {Promise<Buffer>} A promise that resolves with the newest snapshot as a Buffer.
   */
  private getNewestSnapshotBuffer(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.fetchCurrentCameraSnapshot()
        .catch((err) => reject(err));

      const requestTimeout = setTimeout(() => {
        reject('snapshot request timed out');
      }, SNAPSHOT_TIMEOUT);

      this.once('new snapshot', () => {
        clearTimeout(requestTimeout);

        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image);
        } else {
          reject('Unknown snapshot request error');
        }
      });
    });
  }

  /**
   * Get a balanced snapshot based on various conditions.
   * @returns {Promise<Buffer>} A promise that resolves with the snapshot as a Buffer.
   */
  private getBalancedSnapshot(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let snapshotTimeout = setTimeout(() => {
        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image);
        } else {
          resolve(this.platform.SnapshotUnavailable);
        }
      }, 1000);

      this.fetchCurrentCameraSnapshot()
        .catch((err) => this.log.warn(`${this.cameraName} ${err}`));

      const newestEvent = Math.max(this.lastRingEvent, this.lastEvent);
      const diff = (Date.now() - newestEvent) / 1000;
      if (diff < 15) {
        this.log.debug(`${this.cameraName} Waiting on cloud snapshot...`);
        clearTimeout(snapshotTimeout);
        snapshotTimeout = setTimeout(() => {
          if (this.currentSnapshot) {
            resolve(this.currentSnapshot.image);
          } else {
            resolve(this.platform.SnapshotUnavailable);
          }
        }, SNAPSHOT_TIMEOUT);
      }

      this.once('new snapshot', () => {
        clearTimeout(snapshotTimeout);
        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image);
        } else {
          resolve(this.platform.SnapshotUnavailable);
        }
      });
    });
  }

  /**
   * Get the newest snapshot from the cloud.
   * @returns {Promise<Buffer>} A promise that resolves with the newest cloud snapshot as a Buffer.
   */
  private async getNewestCloudSnapshot(): Promise<Buffer> {
    const resolveWithLog = (buffer: Buffer, message: string) => {
      this.log.debug(`${this.cameraName} ${message}`);
      return buffer;
    };

    const newestEvent = Math.max(this.lastRingEvent, this.lastEvent);
    const diff = (Date.now() - newestEvent) / 1000;

    if (diff < 15) {
      return new Promise((resolve, reject) => {
        const snapshotTimeout = setTimeout(() => {
          reject('No snapshot has been retrieved in time from eufy cloud.');
        }, SNAPSHOT_TIMEOUT);

        this.once('new snapshot', () => {
          clearTimeout(snapshotTimeout);
          resolve(this.currentSnapshot ?
            resolveWithLog(this.currentSnapshot.image, 'Resolving with current snapshot.') :
            resolveWithLog(this.platform.SnapshotUnavailable, 'Resolving with unavailable snapshot.'),
          );
        });
      });
    }

    return this.currentSnapshot ?
      resolveWithLog(this.currentSnapshot.image, 'Resolving with current snapshot.') :
      resolveWithLog(this.platform.SnapshotUnavailable, 'Resolving with unavailable snapshot.');
  }

  /**
   * Automatically refresh the snapshot at a specified interval.
   */
  private automaticSnapshotRefresh(): void {
    this.log.debug(`${this.cameraName} Automatic snapshot refresh triggered.`);

    this.fetchCurrentCameraSnapshot()
      .catch((err) => this.log.warn(`${this.cameraName} ${err}`));

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
   * Store the image buffer to a file.
   * @param {string} file - The filename to store the image.
   * @param {Buffer} image - The image buffer to store.
   */
  private storeImage(file: string, image: Buffer): void {
    const filePath = `${this.platform.eufyPath}/${file}`;
    try {
      fs.writeFileSync(filePath, image);
      this.log.debug(`${this.cameraName} Stored Image: ${filePath}`);
    } catch (error) {
      this.log.error(`${this.cameraName} Error storing image at ${filePath} - ${error}`);
    }
  }

  /**
   * Handle property value changes for the device.
   * @param {Device} device - The device whose property has changed.
   * @param {string} name - The name of the property that has changed.
   * @param {PropertyValue} value - The new value of the property.
   * @returns {Promise<void>}
   */
  private async onPropertyValueChanged(device: Device, name: string, value: PropertyValue): Promise<void> {
    if (name === PropertyName.DevicePicture) {
      const picture = value as Picture;
      if (picture && picture.type) {
        this.storeImage(`${device.getSerial()}.${picture.type.ext}`, picture.data);
        this.currentSnapshot = { timestamp: Date.now(), image: picture.data };
        this.emit('new snapshot');
      }
    }
  }

  /**
   * Fetch the current snapshot from the camera and store it in memory.
   * @returns {Promise<void>}
   */
  private async fetchCurrentCameraSnapshot(): Promise<void> {
    if (this.refreshProcessRunning) {
      return;
    }

    this.refreshProcessRunning = true;
    this.log.debug(`${this.cameraName} Locked refresh process.`);

    try {
      const snapshotBuffer = await this.getCurrentCameraSnapshot();
      this.currentSnapshot = {
        timestamp: Date.now(),
        image: snapshotBuffer as Buffer,
      };
      this.emit('new snapshot');
      this.log.debug(`${this.cameraName} Stored new snapshot from camera in memory.`);
    } catch (err) {
      this.log.warn(`${this.cameraName} ${err}`);
    } finally {
      this.refreshProcessRunning = false;
      this.log.debug(`${this.cameraName} Unlocked refresh process.`);
    }
  }

  /**
   * Get the current snapshot from the camera source.
   * @returns {Promise<Buffer>} A promise that resolves with the snapshot as a Buffer.
   */
  private async getCurrentCameraSnapshot(): Promise<Buffer | undefined> {
    // const source = await this.getCameraSource();

    // if (!source) {
    //   throw new Error('No camera source detected.');
    // }

    // const parameters = await FFmpegParameters.forSnapshot(this.cameraConfig.videoConfig?.debug);

    // if (source.url) {
    //   parameters.setInputSource(source.url);
    // } else if (source.stream && source.livestreamId) {
    //   parameters.setInputStream(source.stream);
    // } else {
    //   throw new Error('No valid camera source detected.');
    // }

    // if (this.cameraConfig.delayCameraSnapshot) {
    //   parameters.setDelayedSnapshot();
    // }

    // try {
    //   const ffmpeg = new FFmpeg(
    //     `[${this.cameraName}] [Snapshot Process]`,
    //     [parameters],
    //     this.platform.ffmpegLogger,
    //   );

    //   if (source.stream && source.livestreamId && ffmpeg.stdin) {
    //     source.stream.pipe(ffmpeg.stdin[0]);
    //   }

    //   const buffer = await ffmpeg.getResult();

    //   if (source.livestreamId) {
    //     this.livestreamManager.stopLocalLiveStream();
    //   }

    //   return buffer;
    // } catch (error) {
    //   if (source.livestreamId) {
    //     this.livestreamManager.stopLocalLiveStream();
    //   }
    //   throw (error);
    // }
    return;
  }

  /**
   * Get the camera source either from RTSP or local livestream.
   * @returns {Promise<StreamSource | null>} A promise that resolves with the camera source or null if not available.
   */
  // private async getCameraSource(): Promise<StreamSource | null> {
  //   if (is_rtsp_ready(this.device, this.cameraConfig, this.log)) {
  //     try {
  //       const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) as string;
  //       this.log.debug(`${this.cameraName} RTSP URL: ${url}`);
  //       return { url };
  //     } catch (err) {
  //       this.log.warn(`${this.cameraName} Could not get snapshot from RTSP stream!`);
  //       return null;
  //     }
  //   } else {
  //     try {
  //       const streamData = await this.livestreamManager.getLocalLivestream();
  //       return {
  //         stream: streamData.vStream,
  //         livestreamId: streamData.createdAt,
  //       };
  //     } catch (err) {
  //       this.log.warn(`${this.cameraName} Could not get snapshot from livestream!`);
  //       return null;
  //     }
  //   }
  // }

  /**
   * Resize a snapshot based on provided SnapshotRequest.
   * @param snapshot - Buffer containing the snapshot image
   * @param request - SnapshotRequest containing the dimensions and reason
   * @returns A Promise that resolves with the resized image buffer
   */
  public resizeSnapshot(snapshot: Buffer, request: SnapshotRequest): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      sharp(snapshot)
        .jpeg()
        .resize(request.width, request.height)
        .toFormat('jpeg')
        .toBuffer()
        .then(outputBuffer => {
          this.log.debug(`${this.cameraName} Image resized successfully for reason: ${request.reason}`);

          // Save the snapshot into a file
          return sharp(outputBuffer).toFile(`${this.platform.eufyPath}/${this.camera.SN}_resizedSnapshot.jpg`)
            .then(() => {
              resolve(outputBuffer);
            });
        })
        .catch(err => {
          this.log.debug(`${this.cameraName} Error resizing image for reason: ${request.reason}, Error: ${err}`);
          reject(err);
        });
    });
  }
}