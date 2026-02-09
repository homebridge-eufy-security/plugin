import { Duplex, Writable } from 'stream';

import { EufySecurityPlatform } from '../platform';
import { Device, EufySecurity, Station } from 'eufy-security-client';
import { log } from './utils';

export class TalkbackStream extends Duplex {

  private eufyClient: EufySecurity;
  private cameraName: string;
  private cameraSN: string;

  private cacheData: Array<Buffer> = [];
  private talkbackStarted = false;
  private stopTalkbackTimeout?: NodeJS.Timeout;

  private targetStream?: Writable;

  constructor(platform: EufySecurityPlatform, camera: Device) {
    super();

    this.eufyClient = platform.eufyClient;
    this.cameraName = camera.getName();
    this.cameraSN = camera.getSerial();

    this.eufyClient.on('station talkback start', this.onTalkbackStarted);
    this.eufyClient.on('station talkback stop', this.onTalkbackStopped);
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
    // remove event listeners
    this.eufyClient.removeListener('station talkback start', this.onTalkbackStarted);
    this.eufyClient.removeListener('station talkback stop', this.onTalkbackStopped);

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

    if (this.targetStream) {
      this.push(chunk);
    } else {
      this.cacheData.push(chunk);
      this.startTalkback();
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