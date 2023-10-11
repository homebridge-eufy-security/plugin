import { Camera, PropertyName } from '@homebridge-eufy-security/eufy-security-client';

import { CameraConfig } from './configTypes';
import { Logger as TsLogger, ILogObj } from 'tslog';
import { Duplex } from 'stream';
import net from 'net';
import path from 'path';
import { tmpdir } from 'os';
import fse from 'fs-extra';

export const is_rtsp_ready = function (device: Camera, cameraConfig: CameraConfig, log: TsLogger<ILogObj>): boolean {

  log.debug(device.getName(), 'RTSP rtspStream:' + JSON.stringify(device.hasProperty('rtspStream')));
  if (!device.hasProperty('rtspStream')) {
    log.debug(device.getName(), 'Looks like not compatible with RTSP');
    return false;
  }

  log.debug(device.getName(), 'RTSP cameraConfig: ' + JSON.stringify(cameraConfig.rtsp));
  if (!cameraConfig.rtsp) {
    log.debug(device.getName(), 'Looks like RTSP is not enabled on camera config');
    return false;
  }

  log.debug(device.getName(), 'RTSP ' + JSON.stringify(device.getPropertyValue(PropertyName.DeviceRTSPStream)));
  if (!device.getPropertyValue(PropertyName.DeviceRTSPStream)) {
    log.debug(device.getName(), ': RTSP capabilities not enabled. You will need to do it manually!');
    return false;
  }

  log.debug(device.getName(), 'RTSP ' + JSON.stringify(device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl)));
  if (device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) === '') {
    log.debug(device.getName(), ': RTSP URL is unknow');
    return false;
  }

  return true;
};

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

export const lowestUnusedNumber = function (sequence: number[], startingFrom: number): number {
  const arr = sequence.slice(0);
  arr.sort((a, b) => a - b);
  return arr.reduce((lowest, num, i) => {
    const seqIndex = i + startingFrom;
    return num !== seqIndex && seqIndex < lowest ? seqIndex : lowest;
  }, arr.length + startingFrom);
};

export class UniversalStream {

  public url: string;
  private static socks = new Set<number>();
  private server: net.Server;
  private sock_id: number;

  private constructor(namespace: string, onSocket: ((socket: net.Socket) => void) | undefined) {
    const unique_sock_id = lowestUnusedNumber([...UniversalStream.socks], 1);
    UniversalStream.socks.add(unique_sock_id);
    this.sock_id = unique_sock_id;

    const sockpath = this.generateSockPath(namespace, unique_sock_id);
    this.url = this.generateUrl(sockpath);

    this.server = net.createServer(onSocket).on('error', (err) => {
      // Handle error
    });
    this.server.listen(sockpath);
  }

  private generateSockPath(namespace: string, unique_sock_id: number): string {
    let sockpath = '';
    if (process.platform === 'win32') {
      const pipePrefix = '\\\\.\\pipe\\';
      const pipeName = `node-webrtc.${namespace}.${unique_sock_id}.sock`;
      sockpath = path.join(pipePrefix, pipeName);
    } else {
      const pipeName = `${namespace}.${unique_sock_id}.sock`;
      sockpath = path.join(tmpdir(), pipeName);

      if (fse.existsSync(sockpath)) {
        fse.unlinkSync(sockpath);
      }
    }
    return sockpath;
  }

  private generateUrl(sockpath: string): string {
    return process.platform === 'win32' ? sockpath : 'unix:' + sockpath;
  }

  public close(): void {
    if (this.server) {
      this.server.close();
      if (process.platform !== 'win32') {
        fse.unlinkSync(this.url.replace('unix:', ''));
      }
    }
    UniversalStream.socks.delete(this.sock_id);
  }

  public static StreamInput(namespace: string, stream: NodeJS.ReadableStream): UniversalStream {
    return new UniversalStream(namespace, (socket: net.Socket) => stream.pipe(socket, { end: true }));
  }

  public static StreamOutput(namespace: string, stream: NodeJS.WritableStream): UniversalStream {
    return new UniversalStream(namespace, (socket: net.Socket) => socket.pipe(stream, { end: true }));
  }
}