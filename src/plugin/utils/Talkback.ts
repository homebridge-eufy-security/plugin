import { Duplex, Writable } from 'stream';

import { EufySecurityPlatform } from '../platform';
import { Device, EufySecurity, Station } from 'eufy-security-client';
import { log } from './utils';
import { PROTECT_TWOWAY_HEARTBEAT_INTERVAL } from '../settings';

/**
 * TalkbackStream provides two-way audio communication with Eufy cameras
 * It extends the Duplex stream class to manage audio input/output
 */
export class TalkbackStream extends Duplex {
  // Dependencies
  private eufyClient: EufySecurity;
  private cameraName: string;
  private cameraSN: string;

  // Stream state
  private cacheData: Buffer[] = [];
  private talkbackStarted = false;
  private stopTalkbackTimeout?: NodeJS.Timeout;
  private targetStream?: Writable;

  constructor(platform: EufySecurityPlatform, camera: Device) {
    super();

    // Initialize properties
    this.eufyClient = platform.eufyClient;
    this.cameraName = camera.getName();
    this.cameraSN = camera.getSerial();

    // Bind methods to preserve 'this' context for event handlers
    this.onTalkbackStarted = this.onTalkbackStarted.bind(this);
    this.onTalkbackStopped = this.onTalkbackStopped.bind(this);

    // Set up event listeners
    this.eufyClient.on('station talkback start', this.onTalkbackStarted);
    this.eufyClient.on('station talkback stop', this.onTalkbackStopped);
  }

  /**
   * Handle talkback start event from the station
   */
  private onTalkbackStarted(station: Station, device: Device, stream: Writable): void {
    // Make sure this event is for our camera
    if (device.getSerial() !== this.cameraSN) {
      return;
    }

    log.debug(this.cameraName, `talkback started event from station ${station.getName()}`);

    // Clean up any existing stream connection
    if (this.targetStream) {
      this.unpipe(this.targetStream);
    }

    // Set up new stream connection
    this.targetStream = stream;
    this.pipe(this.targetStream);
  }

  /**
   * Handle talkback stop event from the station
   */
  private onTalkbackStopped(station: Station, device: Device): void {
    // Make sure this event is for our camera
    if (device.getSerial() !== this.cameraSN) {
      return;
    }

    log.debug(this.cameraName, `talkback stopped event from station ${station.getName()}`);

    // Clean up stream connection
    if (this.targetStream) {
      this.unpipe(this.targetStream);
      this.targetStream = undefined;
    }
  }

  /**
   * Stop the talkback stream and clean up resources
   */
  public stopTalkbackStream(): void {
    // Remove event listeners
    this.eufyClient.removeListener('station talkback start', this.onTalkbackStarted);
    this.eufyClient.removeListener('station talkback stop', this.onTalkbackStopped);

    // Stop active talkback session
    this.stopTalkback();
    
    // Clean up stream
    if (this.targetStream) {
      this.unpipe(this.targetStream);
      this.targetStream = undefined;
    }
    
    this.destroy();
  }

  /**
   * Handle read operations from the duplex stream
   * Pushes data from the cache to the read queue
   */
  override _read(): void {
    // Process all cached data
    while (this.cacheData.length > 0) {
      const data = this.cacheData.shift();
      const pushSucceeded = this.push(data);
      
      // If push returns false, we should stop pushing data
      if (!pushSucceeded) break;
    }
  }

  /**
   * Handle write operations to the duplex stream
   * Writes data to the target station or caches it until connection is ready
   */
  override _write(
    chunk: Buffer, 
    encoding: BufferEncoding, 
    callback: (error?: Error | null | undefined) => void
  ): void {
    // Reset timeout each time we receive data
    this.resetTalkbackTimeout();

    // If we have an active target stream, send data directly
    // Otherwise cache it until connection is established
    if (this.targetStream) {
      this.push(chunk);
    } else {
      this.cacheData.push(chunk);
      this.startTalkback();
    }
    
    callback();
  }

  /**
   * Reset the talkback auto-stop timeout
   */
  private resetTalkbackTimeout(): void {
    if (this.stopTalkbackTimeout) {
      clearTimeout(this.stopTalkbackTimeout);
    }

    // Auto-stop talkback after inactivity
    this.stopTalkbackTimeout = setTimeout(
      () => this.stopTalkback(),
      PROTECT_TWOWAY_HEARTBEAT_INTERVAL * 1000
    );
  }

  /**
   * Start the talkback session with the station
   */
  private startTalkback(): void {
    if (!this.talkbackStarted) {
      this.talkbackStarted = true;
      log.debug(this.cameraName, 'starting talkback');
      
      this.eufyClient.startStationTalkback(this.cameraSN)
        .catch(error => {
          log.error(this.cameraName, `talkback could not be started: ${error}`);
        });
    }
  }

  /**
   * Stop the talkback session with the station
   */
  private stopTalkback(): void {
    if (this.talkbackStarted) {
      this.talkbackStarted = false;
      log.debug(this.cameraName, 'stopping talkback');
      
      this.eufyClient.stopStationTalkback(this.cameraSN)
        .catch(error => {
          log.error(this.cameraName, `talkback could not be stopped: ${error}`);
        });
    }
  }
}