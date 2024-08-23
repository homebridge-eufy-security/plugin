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

export class UniversalStream {

  public url: string;
  private static socks = new Set<number>();
  private server: net.Server;
  private sock_id: number;
  private isWin32: boolean = false;
  private readonly startTime = Date.now();

  private constructor(
    namespace: string,
    onSocket: ((socket: net.Socket) => void) | undefined,
  ) {
    this.isWin32 = process.platform === 'win32'; // Cache platform check

    const unique_sock_id = Math.min(...Array.from({ length: 100 }, (_, i) => i + 1).filter(i => !UniversalStream.socks.has(i)));
    UniversalStream.socks.add(unique_sock_id);
    this.sock_id = unique_sock_id;

    const sockpath = this.generateSockPath(namespace, unique_sock_id);
    this.url = this.generateUrl(sockpath);

    this.server = net.createServer(onSocket)
      .on('error', (error) => {
        // More robust error handling
        ffmpegLogger.debug('Server error:', error);
        this.close();
      })
      .listen(sockpath, () => {
        ffmpegLogger.debug('Server is listening');
      });
  }

  private generateSockPath(namespace: string, unique_sock_id: number): string {
    const stepStartTime = Date.now(); // Start time for this step

    let sockpath = '';
    const pipeName = `${namespace}.${unique_sock_id}.sock`; // Use template literals

    if (this.isWin32) {
      const pipePrefix = '\\\\.\\pipe\\';
      sockpath = path.join(pipePrefix, pipeName);
    } else {
      sockpath = path.join(tmpdir(), pipeName);

      // Use async file operations
      if (fse.existsSync(sockpath)) {
        fse.unlinkSync(sockpath);
      }
    }

    const stepEndTime = Date.now(); // End time for this step
    ffmpegLogger.debug(`Time taken for generateSockPath: ${stepEndTime - stepStartTime}ms (Total time from start: ${stepEndTime - this.startTime}ms)`);

    return sockpath;
  }

  private generateUrl(sockpath: string): string {
    return this.isWin32 ? sockpath : `unix:${sockpath}`; // Use template literals
  }

  public close(): void {
    try {
      if (this.server) {
        this.server.close();
      }
    } catch (error) {
      ffmpegLogger.debug(`An error occurred while closing the server: ${error}`);
    } finally {
      if (!this.isWin32 && this.url) {
        try {
          fse.unlinkSync(this.url.replace('unix:', ''));
        } catch (error) {
          ffmpegLogger.debug(`An error occurred while unlinking the file: ${error}`);
        }
      }
      UniversalStream.socks.delete(this.sock_id);
      ffmpegLogger.debug('Resources cleaned up.');
    }
  }

  public static StreamInput(namespace: string, stream: NodeJS.ReadableStream): UniversalStream {
    return new UniversalStream(namespace, (socket: net.Socket) => stream.pipe(socket, { end: true }));
  }

  public static StreamOutput(namespace: string, stream: NodeJS.WritableStream): UniversalStream {
    return new UniversalStream(namespace, (socket: net.Socket) => socket.pipe(stream, { end: true }));
  }
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