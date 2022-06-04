import https from 'node:https';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:stream';
import { spawn } from 'child_process';

import { Camera, Device, PropertyName, PropertyValue } from 'eufy-security-client';
import ffmpegPath from 'ffmpeg-for-homebridge';

import { CameraConfig } from './configTypes';
import { EufySecurityPlatform } from '../platform';
import { LocalLivestreamManager } from './LocalLivestreamManager';
import { Logger } from './logger';
import { StreamInput } from './UniversalStream';

import { is_rtsp_ready } from '../utils/utils';

const SnapshotBlackPath = require.resolve('../../media/Snapshot-black.png');

type Snapshot = {
  timestamp: number;
  image: Buffer;
  sourceUrl?: string;
};

type SnapshotManagerRequest = {
  timestamp: number;
  resolveTimeout?: NodeJS.Timeout;
  promiseCallback: (boolean) => void;
};

type ImageDataResponse = {
  url: string;
  image: Buffer;
};

type StreamSource = {
  url: string;
  livestreamId?: number;
};

/**
 * possible performance settings:
 * 1. snapshots as current as possible (weak homebridge performance) -> forceRefreshSnapshot
 *    - always get a new image from cloud or cam
 * 2. balanced
 *    - option to decide what time difference is ok
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

  private log;
  private livestreamManager;

  private lastCloudSnapshot?: Snapshot;
  private currentSnapshot?: Snapshot;
  private blackSnapshot?: Buffer;
  // private unfulfilledSnapshotRequests: Map<number, SnapshotManagerRequest> = new Map<number, SnapshotManagerRequest>();
  // private snapShotRequestCounter = 1;

  private refreshProcessRunning = false;
  private lastEvent = 0;
  private lastRingEvent = 0;

  private snapshotRefreshTimer?: NodeJS.Timeout;

  // eslint-disable-next-line max-len
  constructor(platform: EufySecurityPlatform, device: Camera, cameraConfig: CameraConfig, livestreamManager: LocalLivestreamManager, log: Logger) {
    super();

    this.log = log;
    this.platform = platform;
    this.device = device;
    this.cameraConfig = cameraConfig;
    this.livestreamManager = livestreamManager;

    this.device.on('property changed', this.onPropertyValueChanged.bind(this));

    this.device.on('crying detected', (device, state) => this.onEvent(device, state));
    this.device.on('motion detected', (device, state) => this.onEvent(device, state));
    this.device.on('person detected', (device, state) => this.onEvent(device, state));
    this.device.on('pet detected', (device, state) => this.onEvent(device, state));
    this.device.on('sound detected', (device, state) => this.onEvent(device, state));
    this.device.on('rings', (device, state) => this.onRingEvent(device, state));

    if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
      if (this.cameraConfig.refreshSnapshotIntervalMinutes < 5) {
        this.log.warn(this.device.getName(), 'The interval to automatically refresh snapshots is set too low. Minimum is one minute.');
        this.cameraConfig.refreshSnapshotIntervalMinutes = 5;
      }
      // eslint-disable-next-line max-len
      this.log.info(this.device.getName(), 'Setting up automatic snapshot refresh every ' + this.cameraConfig.refreshSnapshotIntervalMinutes + ' minutes. This may decrease battery life dramatically.');
      setTimeout(() => { // give homebridge some time to start up
        this.automaticSnapshotRefresh();
      }, 60 * 1000);
    }

    if (this.cameraConfig.snapshotHandlingMethod === 1) {
      // eslint-disable-next-line max-len
      this.log.info(this.device.getName(), 'is set to generate new snapshots on events every time. This might reduce homebridge performance and increase power consumption.');
    } else if (this.cameraConfig.snapshotHandlingMethod === 2) {
      this.log.info(this.device.getName(), 'is set to balanced snapshot handling.');
    } else if (this.cameraConfig.snapshotHandlingMethod === 3) {
      this.log.info(this.device.getName(), 'is set to handle snapshots with cloud images. Snapshots might be older than they appear.');
    } else {
      this.log.warn(this.device.getName(), 'unknown snapshot handling method. SNapshots will not be generated.');
    }

    try {
      this.blackSnapshot = readFileSync(SnapshotBlackPath);
      if (this.cameraConfig.immediateRingNotificationWithoutSnapshot) {
        this.log.info(this.device.getName(), 'Empty snapshot will be sent on ring events immediately to spped up homekit notifications.');
      }
    } catch (err) {
      this.log.error(this.device.getName(), 'could not cache black snapshot file for further use: ' + err);
    }
  }

  private onRingEvent(device: Device, state: boolean) {
    if (state) {
      this.log.debug(this.device.getName(), 'Snapshot handler detected ring event.');
      this.lastRingEvent = Date.now();
    }
  }

  private onEvent(device: Device, state: boolean) {
    if (state) {
      this.log.debug(this.device.getName(), 'Snapshot handler detected event.');
      this.lastEvent = Date.now();
    }
  }

  public async getSnapshotBuffer(): Promise<Buffer> {
    // return a new snapshot it it is recent enough (not more than 10 seconds)
    if (this.currentSnapshot) {
      const diff = Math.abs((Date.now() - this.currentSnapshot.timestamp) / 1000);
      if (diff <= 10) {
        return Promise.resolve(this.currentSnapshot.image);
      }
    }

    const diff = (Date.now() - this.lastRingEvent) / 1000;
    if (this.cameraConfig.immediateRingNotificationWithoutSnapshot && diff < 5) {
      this.log.debug(this.device.getName(), 'Sending empty snapshot to spped up homekit notification for ring event.');
      if (this.blackSnapshot) {
        return Promise.resolve(this.blackSnapshot);
      } else {
        return Promise.reject('Prioritize ring notification over snapshot request. But could not supply empty snapshot.');
      }
    }

    if (this.cameraConfig.snapshotHandlingMethod === 1) {
      // return a preferablly most recent snapshot every time
      return this.getNewestSnapshotBuffer();
    } else if (this.cameraConfig.snapshotHandlingMethod === 2) {
      // balanced method
      // TODO
      return Promise.reject('balanced method not implemented yet');
    } else if (this.cameraConfig.snapshotHandlingMethod === 3) {
      // fastest method with potentially old snapshots
      return this.getNewestCloudSnapshot();
    } else {
      return Promise.reject('No suitable handling method for snapshots defined');
    }
  }

  private async getNewestSnapshotBuffer(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // const latestSnapshotTimestamp = (this.currentSnapshot) ? this.currentSnapshot.timestamp : 0;
      // const diff = (Date.now() - latestSnapshotTimestamp) / 1000;
      // if (diff < 5) { // snapshot is not older than 5 seconds: use it!
      //   resolve(this.currentSnapshot!.image);
      //   return;
      // }

      if (!this.refreshProcessRunning) {
        this.fetchCurrentCameraSnapshot();
      }

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

  private async getNewestCloudSnapshot(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // const latestSnapshotTimestamp = (this.currentSnapshot) ? this.currentSnapshot.timestamp : 0;
      // let diff = (Date.now() - latestSnapshotTimestamp) / 1000;
      // if (diff < 5) { // snapshot is not older than 5 seconds: use it!
      //   resolve(this.currentSnapshot!.image);
      //   return;
      // }

      const newestEvent = (this.lastRingEvent > this.lastEvent) ? this.lastRingEvent : this.lastEvent;
      const diff = (Date.now() - newestEvent) / 1000;
      if (diff < 15) { // wait for cloud snapshot
        this.log.debug(this.device.getName(), 'Waiting on cloud snapshot...');
        const snapshotTimeout = setTimeout(() => {
          reject('No snapshot has been retrieved in time from eufy cloud.');
        }, 15000);

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
      } else {
        if (this.currentSnapshot) {
          resolve(this.currentSnapshot.image);
        } else {
          reject('No snapshot in memory');
        }
      }
    });
  }

  // private removeSnapshotRequest(id: number): void {
  //   this.unfulfilledSnapshotRequests.delete(id);
  // }

  private automaticSnapshotRefresh() {
    this.log.debug(this.device.getName(), 'Automatic snapshot refresh triggered.');
    this.fetchCurrentCameraSnapshot();
    if (this.snapshotRefreshTimer) {
      clearTimeout(this.snapshotRefreshTimer);
    }
    if (this.cameraConfig.refreshSnapshotIntervalMinutes) {
      this.snapshotRefreshTimer = setTimeout(() => {
        this.automaticSnapshotRefresh();
      }, this.cameraConfig.refreshSnapshotIntervalMinutes * 60 * 1000);
    }
  }

  // private fulfillUnresolvedSnapshotRequests(): void {
  //   // A new 
  //   // TODO
  // }

  private async onPropertyValueChanged(device: Device, name: string, value: PropertyValue): Promise<void> {
    if (name === 'pictureUrl') {
      this.handlePictureUrl(value as string);
    }
  }

  private async handlePictureUrl(url: string): Promise<void> {
    this.log.debug(this.device.getName(), 'Got picture Url from eufy cloud: ' + url);
    if (!this.lastCloudSnapshot ||
        (this.lastCloudSnapshot && this.lastCloudSnapshot.sourceUrl && this.lastCloudSnapshot.sourceUrl !== url)) {
      try {
        const timestamp = Date.now();
        const response = await this.downloadImageData(url);
        if (!this.lastCloudSnapshot ||
            (this.lastCloudSnapshot && this.lastCloudSnapshot.timestamp < timestamp)) {
          this.log.debug(this.device.getName(), 'stored new snapshot from cloud in memory.');
          this.lastCloudSnapshot = {
            timestamp: timestamp,
            sourceUrl: response.url,
            image: response.image,
          };
          if (!this.currentSnapshot ||
              (this.currentSnapshot && this.currentSnapshot.timestamp < timestamp)) {
            this.log.debug(this.device.getName(), 'cloud snapshot is most recent one. Storing this for future use.');
            this.currentSnapshot = this.lastCloudSnapshot;
          }
          this.emit('new snapshot');
        }
      } catch (err) {
        this.log.debug(this.device.getName(), 'image data could not be retireved: ' + err);
      }
    } else {
      this.log.debug(this.device.getName(), 'picture Url was already known. Ignore it.');
    }
  }

  private downloadImageData(url: string, retries = 30): Promise<ImageDataResponse> {
    return new Promise((resolve, reject) => {
      https.get(url, response => {
        if (response.headers.location) { // url forwarding; use new url
          this.downloadImageData(response.headers.location, retries)
            .then((imageResponse) => resolve(imageResponse))
            .catch((err) => reject(err));
        } else { // get image buffer
          let imageBuffer = Buffer.alloc(0);
          response.on('data', (chunk: Buffer) => {
            imageBuffer = Buffer.concat([imageBuffer, chunk]);
          });
          response.on('end', () => {
            if (!this.isXMLNotImage(imageBuffer) && response.statusCode && response.statusCode < 400) {
              resolve({
                url: url,
                image: imageBuffer,
              });
            } else if (retries <= 0) {
              reject('Could not get image data');
            } else {
              setTimeout(() => {
                this.downloadImageData(url, retries-1)
                  .then((imageResponse) => resolve(imageResponse))
                  .catch((err) => reject(err));
              }, 500);
            }
          });
          response.on('error', (err) => {
            reject(err);
          });
        }
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  private isXMLNotImage(dataBuffer: Buffer): boolean {
    const possibleXML = dataBuffer.toString('utf8');
    return (possibleXML.indexOf('<?xml') !== -1 ||
            possibleXML.indexOf('<xml') !== -1 ||
            possibleXML.indexOf('<?html') !== -1 ||
            possibleXML.indexOf('<html') !== -1);
  }

  private async fetchCurrentCameraSnapshot(): Promise<void> {
    this.refreshProcessRunning = true;
    this.log.debug(this.device.getName(), 'Locked refresh process.');
    this.log.debug(this.device.getName(), 'Fetching new snapshot from camera.');
    const timestamp = Date.now();
    try {
      const snapshotBuffer = await this.getCurrentCameraSnapshot();

      if (!this.currentSnapshot || (this.currentSnapshot && this.currentSnapshot.timestamp < timestamp)) {
        this.log.debug(this.device.getName(), 'stored new snapshot from camera in memory. Using this for future use.');
        this.currentSnapshot = {
          timestamp: timestamp,
          image: snapshotBuffer,
        };
        this.emit('new snapshot');
        this.refreshProcessRunning = false;
        this.log.debug(this.device.getName(), 'Unlocked refresh process.');
      }
      return Promise.resolve();
    } catch (err) {
      this.refreshProcessRunning = false;
      this.log.debug(this.device.getName(), 'Unlocked refresh process.');
      return Promise.reject(err);
    }
  }

  private async getCurrentCameraSnapshot(): Promise<Buffer> {
    const source = await this.getCameraSource();

    return new Promise((resolve, reject) => {
      if (!source) {
        return;
      }

      const url = '-i ' + source.url;
      const ffmpegArgs = (this.cameraConfig.videoConfig!.stillImageSource || url) + // Still
                      ' -frames:v 1' +
                      ' -f image2 -' +
                      ' -hide_banner' +
                      ' -loglevel error';
      
      this.log.debug(
        this.device.getName(),
        'Snapshot command: ' + this.videoProcessor + ' ' + ffmpegArgs,
        this.cameraConfig.videoConfig!.debug,
      );
      const startTime = Date.now();
      const ffmpeg = spawn(this.videoProcessor, ffmpegArgs.split(/\s+/), { env: process.env });

      const ffmpegTimeout = setTimeout(() => {
        reject('ffmpeg process timed out');
      }, 15000);

      let snapshotBuffer = Buffer.alloc(0);
      ffmpeg.stdout.on('data', (data) => {
        snapshotBuffer = Buffer.concat([snapshotBuffer, data]);
      });
      ffmpeg.on('error', (error: Error) => {
        reject('FFmpeg process creation failed: ' + error.message);
      });
      ffmpeg.stderr.on('data', (data) => {
        data.toString().split('\n').forEach((line: string) => {
          if (this.cameraConfig.videoConfig!.debug && line.length > 0) { // For now only write anything out when debug is set
            this.log.error(line, this.device.getName() + '] [Snapshot');
          }
        });
      });
      ffmpeg.on('close', () => {
        if (ffmpegTimeout) {
          clearTimeout(ffmpegTimeout);
        }

        if (snapshotBuffer.length > 0) {
          resolve(snapshotBuffer);
        } else {
          reject(' Failed to fetch snapshot.');
        }

        if (source.livestreamId !== null) {
          this.livestreamManager.stopProxyStream(source.livestreamId);
        }

        const runtime = (Date.now() - startTime) / 1000;
        let message = 'Fetching snapshot took ' + runtime + ' seconds.';
        if (runtime < 5) {
          this.log.debug(message, this.device.getName(), this.cameraConfig.videoConfig!.debug);
        } else {
          if (!this.cameraConfig.unbridge) {
            message += ' It is highly recommended you switch to unbridge mode.';
          }
          if (runtime < 22) {
            this.log.warn(message, this.device.getName());
          } else {
            message += ' The request has timed out.';
            this.log.error(message, this.device.getName());
          }
        }
      });
    });
  }

  private async getCameraSource(): Promise<StreamSource | null> {
    if (is_rtsp_ready(this.device, this.cameraConfig, this.log)) {
      try {
        const url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
        this.log.debug(this.device.getName(), 'RTSP URL: ' + url);
        return {
          url: url as string,
        };
      } catch (err) {
        this.log.warn(this.device.getName(), 'Could not get snapshot from rtsp stream!');
        return null;
      }
    } else {
      try {
        const streamData = await this.livestreamManager.getLocalLivestream();
        const uVideoStream = StreamInput(streamData.videostream, this.device.getName() + '_video', this.platform.eufyPath, this.log);
        return {
          url: uVideoStream.url,
          livestreamId: streamData.id,
        };
      } catch (err) {
        this.log.warn(this.device.getName(), 'Could not get snapshot from livestream!');
        return null;
      }
    }
  }
}