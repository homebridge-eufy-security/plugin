import { Duplex, Writable } from 'stream';
import { EufySecurityPlatform } from '../platform';
import { Device, Station } from '@homebridge-eufy-security/eufy-security-client';

/**
 * TalkbackStream handles two-way audio streams for a security camera.
 */
export class TalkbackStream extends Duplex {
  private cacheData: Array<Buffer> = [];
  private talkbackStarted = false;
  private stopTalkbackTimeout?: NodeJS.Timeout;
  private targetStream?: Writable;
  private readonly cameraName: string = this.camera.getName();

  /**
   * Constructor: Initialize the TalkbackStream.
   * @param {EufySecurityPlatform} platform - The security platform
   * @param {Device} camera - The camera device
   */
  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly camera: Device,
  ) {
    super();
    this.platform.eufyClient.once('station talkback start', this.onTalkbackStarted);
    this.platform.eufyClient.once('station talkback stop', this.onTalkbackStopped);
  }

  /**
   * Called when talkback stream is started.
   * @param {Station} station - The station initiating the talkback
   * @param {Device} device - The device used in the talkback
   * @param {Writable} stream - The writable stream for talkback
   */
  private onTalkbackStarted(station: Station, device: Device, stream: Writable): void {
    if (device.getSerial() !== this.camera.getSerial()) {
      this.platform.log.error(`${this.cameraName}, mixing stream ${station.getName()}`);
      return;
    }
    this.platform.log.debug(`${this.cameraName}, talkback started event from station ${station.getName()}`);
    this.clearTargetStream();
    this.targetStream = stream;
    this.pipe(this.targetStream);
  }

  /**
   * Called when talkback stream is stopped.
   * @param {Station} station - The station stopping the talkback
   * @param {Device} device - The device used in the talkback
   */
  private onTalkbackStopped(station: Station, device: Device): void {
    if (device.getSerial() === this.camera.getSerial()) {
      this.platform.log.debug(`${this.cameraName}, talkback stopped event from station ${station.getName()}`);
      this.clearTargetStream();
      this.platform.eufyClient.removeListener('station talkback start', this.onTalkbackStarted);
      this.platform.eufyClient.removeListener('station talkback stop', this.onTalkbackStopped);
    }
  }

  /**
   * Stops the talkback stream explicitly and cleans up.
   */
  public stopTalkbackStream(): void {
    this.stopTalkback();
    this.unpipe();
    this.destroy();
  }

  /**
   * Overrides the default read method from the Duplex stream.
   * @param {number} size - The buffer size to read
   */
  override _read(size: number): void {
    let pushReturn = true;
    while (this.cacheData.length > 0 && pushReturn) {
      const data = this.cacheData.shift();
      pushReturn = this.push(data);
    }
  }

  /**
   * Overrides the default write method from the Duplex stream.
   * @param {Buffer} chunk - The chunk of data to write
   * @param {BufferEncoding} encoding - The encoding type
   * @param {function} callback - The callback to execute after writing
   */
  override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.stopTalkbackTimeout && clearTimeout(this.stopTalkbackTimeout);
    this.stopTalkbackTimeout = setTimeout(() => this.stopTalkback(), 2000);

    this.targetStream ? this.push(chunk) : this.cacheData.push(chunk);
    !this.targetStream && this.startTalkback();
    callback();
  }

  /**
   * Starts the talkback stream if not already started.
   */
  private startTalkback(): void {
    if (!this.talkbackStarted) {
      this.talkbackStarted = true;
      this.platform.log.debug(`${this.cameraName}, starting talkback`);
      this.platform.eufyClient.startStationTalkback(this.camera.getSerial())
        .catch(err => this.platform.log.error(`${this.cameraName}, talkback could not be started: ${err}`));
    }
  }

  /**
   * Stops the talkback stream if it is running.
   */
  private stopTalkback(): void {
    if (this.talkbackStarted) {
      this.talkbackStarted = false;
      this.platform.log.debug(`${this.cameraName}, stopping talkback`);
      this.stopTalkbackTimeout && clearTimeout(this.stopTalkbackTimeout);
      this.platform.eufyClient.stopStationTalkback(this.camera.getSerial())
        .catch(err => this.platform.log.error(`${this.cameraName}, talkback could not be stopped: ${err}`));
    }
  }

  /**
   * Clears the target stream and unpipe it.
   */
  private clearTargetStream(): void {
    if (this.targetStream) {
      this.unpipe(this.targetStream);
      this.targetStream = undefined;
    }
  }
}