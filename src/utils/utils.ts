import { Logger, ILogObj } from 'tslog';

import { HAP as HAPHB } from 'homebridge';
import type { Characteristic, Service } from 'homebridge';

import { CameraConfig } from './configTypes';
import { Camera, PropertyName } from 'eufy-security-client';

export let HAP: HAPHB;
export let SERV: typeof Service;
export let CHAR: typeof Characteristic;

export function setHap(hapInstance: HAPHB) {
  HAP = hapInstance;
  SERV = hapInstance.Service;
  CHAR = hapInstance.Characteristic;
}

export let log: Logger<ILogObj> = {} as Logger<ILogObj>;
export let tsLogger: Logger<ILogObj> = {} as Logger<ILogObj>;
export let ffmpegLogger: Logger<ILogObj> = {} as Logger<ILogObj>;

export function initLog(logOptions: ILogObj) {
  log = new Logger(logOptions);
  tsLogger = new Logger({ ...logOptions, type: 'hidden' });
  ffmpegLogger = new Logger({ ...logOptions, type: 'hidden' });
}

export class Deferred<T> {
  finished = false;
  resolve!: (value: T | PromiseLike<T>) => this;
  reject!: (error: Error) => this;
  promise: Promise<T> = new Promise((resolve, reject) => {
    this.resolve = v => {
      this.finished = true;
      resolve(v);
      return this;
    };
    this.reject = e => {
      this.finished = true;
      reject(e);
      return this;
    };
  });
}

export function isRtspReady(device: Camera, cameraConfig: CameraConfig): boolean {
  const name = device.getName();

  const checks: [boolean, string][] = [
    [!device.hasProperty('rtspStream'), 'device not compatible with RTSP'],
    [!cameraConfig.rtsp, 'RTSP not enabled in camera config'],
    [!device.getPropertyValue(PropertyName.DeviceRTSPStream), 'RTSP capability not enabled on device'],
    [device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) === '', 'RTSP URL is unknown'],
  ];

  for (const [failed, reason] of checks) {
    if (failed) {
      log.debug(name, reason);
      return false;
    }
  }

  return true;
}