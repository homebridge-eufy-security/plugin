import { Duplex, Writable } from 'stream';

import { EufySecurityPlatform } from '../platform.js';
import { Device, EufySecurity, Station } from 'eufy-security-client';
import { log } from './utils.js';

/**
 * Split a buffer into individual ADTS frames.
 * FFmpeg writes arbitrary-sized chunks that may contain multiple ADTS frames
 * or partial frames spanning chunk boundaries. The doorbell expects each P2P
 * audio packet to contain exactly one ADTS frame.
 */
function splitAdtsFrames(data: Buffer): { frames: Buffer[]; remainder: Buffer } {
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset + 7 <= data.length) {
    // Check for ADTS syncword (0xFFF in first 12 bits)
    if (data[offset] !== 0xFF || (data[offset + 1] & 0xF0) !== 0xF0) {
      offset++;
      continue;
    }
    // Frame length is in bits 30-42 (13 bits) spanning bytes 3-5
    const frameLength = ((data[offset + 3] & 0x03) << 11) |
                        (data[offset + 4] << 3) |
                        ((data[offset + 5] & 0xE0) >> 5);
    if (frameLength < 7 || offset + frameLength > data.length) {
      break; // incomplete frame — save remainder for next chunk
    }
    frames.push(Buffer.from(data.subarray(offset, offset + frameLength)));
    offset += frameLength;
  }
  const remainder = offset < data.length ? Buffer.from(data.subarray(offset)) : Buffer.alloc(0);
  return { frames, remainder };
}

export class TalkbackStream extends Duplex {

  private eufyClient: EufySecurity;
  private cameraName: string;
  private cameraSN: string;

  private cacheData: Array<Buffer> = [];
  private talkbackStarted = false;
  private stopTalkbackTimeout?: NodeJS.Timeout;

  private targetStream?: Writable;

  // Bound handler references so they can be properly removed
  private _boundOnTalkbackStarted: (station: Station, device: Device, stream: Writable) => void;
  private _boundOnTalkbackStopped: (station: Station, device: Device) => void;

  // ADTS frame accumulation buffer for partial frames across chunks
  private _adtsBuffer: Buffer = Buffer.alloc(0);

  constructor(platform: EufySecurityPlatform, camera: Device) {
    super();

    this.eufyClient = platform.eufyClient;
    this.cameraName = camera.getName();
    this.cameraSN = camera.getSerial();

    // Bind handlers to preserve 'this' context when called as event callbacks
    this._boundOnTalkbackStarted = this.onTalkbackStarted.bind(this);
    this._boundOnTalkbackStopped = this.onTalkbackStopped.bind(this);

    log.debug(this.cameraName, 'TalkbackStream created for device ' + this.cameraSN);

    this.eufyClient.on('station talkback start', this._boundOnTalkbackStarted);
    this.eufyClient.on('station talkback stop', this._boundOnTalkbackStopped);
  }

  private onTalkbackStarted(station: Station, device: Device, stream: Writable) {
    if (device.getSerial() !== this.cameraSN) {
      return;
    }

    log.debug(this.cameraName, 'talkback started event from station ' + station.getName());

    if (this.targetStream) {
      this.unpipe(this.targetStream);
    }

    this.targetStream = stream;
    this.pipe(this.targetStream);

    // Flush any cached audio data now that targetStream is connected
    while (this.cacheData.length > 0) {
      const data = this.cacheData.shift();
      this.push(data);
    }
  }

  private onTalkbackStopped(station: Station, device: Device) {
    if (device.getSerial() !== this.cameraSN) {
      return;
    }

    log.debug(this.cameraName, 'talkback stopped event from station ' + station.getName());

    if (this.targetStream) {
      this.unpipe(this.targetStream);
    }
    this.targetStream = undefined;
  }

  public stopTalkbackStream(): void {
    log.debug(this.cameraName, 'stopTalkbackStream called');
    // Remove event listeners using the bound references
    this.eufyClient.removeListener('station talkback start', this._boundOnTalkbackStarted);
    this.eufyClient.removeListener('station talkback stop', this._boundOnTalkbackStopped);

    this.stopTalkback();
    this.unpipe();
    this.destroy();
  }

  override _read(): void {
    let pushReturn = true;
    while (this.cacheData.length > 0 && pushReturn) {
      const data = this.cacheData.shift();
      pushReturn = this.push(data);
    }
  }

  override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null | undefined) => void): void {

    if (this.stopTalkbackTimeout) {
      clearTimeout(this.stopTalkbackTimeout);
    }

    this.stopTalkbackTimeout = setTimeout(() => {
      this.stopTalkback();
    }, 2000);

    // Accumulate with any leftover partial frame from last chunk
    const buf = this._adtsBuffer.length > 0
      ? Buffer.concat([this._adtsBuffer, chunk])
      : chunk;

    const { frames, remainder } = splitAdtsFrames(buf);
    this._adtsBuffer = remainder;

    // Push each individual ADTS frame as a separate P2P audio packet
    for (const frame of frames) {
      if (this.targetStream) {
        this.push(frame);
      } else {
        this.cacheData.push(frame);
        this.startTalkback();
      }
    }

    callback();
  }

  private startTalkback() {
    if (!this.talkbackStarted) {
      this.talkbackStarted = true;
      log.debug(this.cameraName, 'starting talkback');
      this.eufyClient.startStationTalkback(this.cameraSN)
        .catch(error => {
          log.error(this.cameraName, 'talkback could not be started: ' + error);
        });
    }
  }

  private stopTalkback() {
    if (this.talkbackStarted) {
      this.talkbackStarted = false;
      log.debug(this.cameraName, 'stopping talkback');
      this.eufyClient.stopStationTalkback(this.cameraSN)
        .catch(error => {
          log.error(this.cameraName, 'talkback could not be stopped: ' + error);
        });
    }
  }
}
