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

/**
 * UniversalStream provides a platform-independent streaming abstraction
 * for handling socket communications between processes.
 */
export class UniversalStream {
  /**
   * Track used socket IDs to prevent conflicts
   */
  private static activeSockets = new Set<number>();

  /**
   * Stream properties
   */
  public url: string;
  private server: net.Server;
  private socketId: number;
  private readonly isWindows: boolean;
  private readonly createdAt = Date.now();

  /**
   * Create a universal stream with a socket connection handler
   */
  private constructor(
    namespace: string,
    onSocket: ((socket: net.Socket) => void) | undefined,
  ) {
    // Cache platform check for performance
    this.isWindows = process.platform === 'win32';

    // Find an available socket ID
    this.socketId = this.getNextAvailableSocketId();
    UniversalStream.activeSockets.add(this.socketId);

    // Generate socket path based on platform
    const socketPath = this.generateSocketPath(namespace);
    this.url = this.generateUrl(socketPath);

    // Create and configure server
    this.server = this.createServer(socketPath, onSocket);
  }

  /**
   * Find the next available socket ID
   */
  private getNextAvailableSocketId(): number {
    // Find unused socket IDs from 1-100
    const availableIds = Array.from({ length: 100 }, (_, i) => i + 1)
      .filter(id => !UniversalStream.activeSockets.has(id));
    
    // If we have available IDs, return the lowest one
    if (availableIds.length > 0) {
      return Math.min(...availableIds);
    }
    
    // If all IDs are used, generate a new ID above 100
    // This ensures we always have a valid ID even if all lower IDs are used
    return 101 + UniversalStream.activeSockets.size;
  }

  /**
   * Generate appropriate socket path for the current platform
   */
  private generateSocketPath(namespace: string): string {
    const pipeName = `${namespace}.${this.socketId}.sock`;
    
    if (this.isWindows) {
      // Windows named pipes
      return path.join('\\\\.\\pipe\\', pipeName);
    } else {
      // Unix domain sockets
      const socketPath = path.join(tmpdir(), pipeName);
      
      // Ensure socket doesn't already exist
      if (fse.existsSync(socketPath)) {
        try {
          fse.unlinkSync(socketPath);
        } catch (error) {
          ffmpegLogger.debug(`Failed to unlink existing socket: ${error}`);
        }
      }
      
      return socketPath;
    }
  }

  /**
   * Generate appropriate URL for the socket path
   */
  private generateUrl(socketPath: string): string {
    return this.isWindows ? socketPath : `unix:${socketPath}`;
  }

  /**
   * Create and configure the server
   */
  private createServer(socketPath: string, onSocket: ((socket: net.Socket) => void) | undefined): net.Server {
    return net.createServer(onSocket)
      .on('error', error => {
        ffmpegLogger.debug(`Server error: ${error}`);
        this.close();
      })
      .on('listening', () => {
        ffmpegLogger.debug(`Server listening (took ${Date.now() - this.createdAt}ms)`);
      })
      .listen(socketPath);
  }

  /**
   * Close the stream and clean up resources
   */
  public close(): void {
    // Close the server first
    Promise.resolve().then(() => {
      return new Promise<void>(resolve => {
        if (!this.server) {
          return resolve();
        }
        
        this.server.close(err => {
          if (err) {
            ffmpegLogger.debug(`Error closing server: ${err}`);
          }
          resolve();
        });
      });
    }).then(() => {
      // Clean up socket file if needed
      if (!this.isWindows) {
        const socketPath = this.url.replace('unix:', '');
        try {
          if (fse.existsSync(socketPath)) {
            fse.unlinkSync(socketPath);
          }
        } catch (error) {
          ffmpegLogger.debug(`Failed to unlink socket file: ${error}`);
        }
      }
      
      // Release the socket ID
      UniversalStream.activeSockets.delete(this.socketId);
      ffmpegLogger.debug('Stream resources cleaned up successfully');
    });
  }

  /**
   * Create a stream that receives data from a readable stream
   */
  public static StreamInput(namespace: string, stream: NodeJS.ReadableStream): UniversalStream {
    return new UniversalStream(namespace, socket => {
      // Pipe the input stream to the socket
      stream.pipe(socket, { end: true });
      
      // Handle potential errors
      stream.on('error', error => {
        ffmpegLogger.debug(`Input stream error: ${error}`);
        socket.end();
      });
      
      socket.on('error', error => {
        ffmpegLogger.debug(`Socket error in StreamInput: ${error}`);
      });
    });
  }

  /**
   * Create a stream that sends data to a writable stream
   */
  public static StreamOutput(namespace: string, stream: NodeJS.WritableStream): UniversalStream {
    return new UniversalStream(namespace, socket => {
      // Pipe the socket to the output stream
      socket.pipe(stream, { end: true });
      
      // Handle potential errors
      socket.on('error', error => {
        ffmpegLogger.debug(`Socket error in StreamOutput: ${error}`);
      });
      
      stream.on('error', error => {
        ffmpegLogger.debug(`Output stream error: ${error}`);
        socket.end();
      });
    });
  }
}

/**
 * Check if a camera is ready for RTSP streaming
 */
export const is_rtsp_ready = function (device: Camera, cameraConfig: CameraConfig): boolean {
  // Check if device supports RTSP
  if (!device.hasProperty('rtspStream')) {
    log.debug(device.getName(), 'Device does not support RTSP streaming');
    return false;
  }

  // Check if RTSP is enabled in configuration
  if (!cameraConfig.rtsp) {
    log.debug(device.getName(), 'RTSP is disabled in camera configuration');
    return false;
  }

  // Check if RTSP is enabled on the device
  if (!device.getPropertyValue(PropertyName.DeviceRTSPStream)) {
    log.debug(device.getName(), 'RTSP capabilities not enabled on device. This needs to be enabled manually.');
    return false;
  }

  // Check if RTSP URL is available
  const rtspUrl = device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl);
  if (!rtspUrl || rtspUrl === '') {
    log.debug(device.getName(), 'RTSP URL is not available');
    return false;
  }

  // All checks passed, RTSP is ready
  return true;
};