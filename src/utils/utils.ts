import { Logger, ILogObj } from 'tslog';

import net from 'net';
import path from 'path';
import { tmpdir } from 'os';
import fse from 'fs-extra';

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

export function init_log(logOptions: ILogObj) {
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

export const is_rtsp_ready = function (device: Camera, cameraConfig: CameraConfig): boolean {

  log.debug(device.getName(), 'RTSP rtspStream:', device.hasProperty('rtspStream'));
  if (!device.hasProperty('rtspStream')) {
    log.debug(device.getName(), 'Looks like not compatible with RTSP');
    return false;
  }

  log.debug(device.getName(), 'RTSP cameraConfig: ', cameraConfig.rtsp);
  if (!cameraConfig.rtsp) {
    log.debug(device.getName(), 'Looks like RTSP is not enabled on camera config');
    return false;
  }

  log.debug(device.getName(), 'RTSP ', device.getPropertyValue(PropertyName.DeviceRTSPStream));
  if (!device.getPropertyValue(PropertyName.DeviceRTSPStream)) {
    log.debug(device.getName(), ': RTSP capabilities not enabled. You will need to do it manually!');
    return false;
  }

  log.debug(device.getName(), 'RTSP ', device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl));
  if (device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) === '') {
    log.debug(device.getName(), ': RTSP URL is unknow');
    return false;
  }

  return true;
};