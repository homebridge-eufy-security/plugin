import { Duplex, Writable } from 'stream';

import { EufySecurityPlatform } from '../platform';
import { Device, Station } from 'eufy-security-client';

export class TalkbackStream extends Duplex {

  private platform: EufySecurityPlatform;
  private camera: Device;

  private cacheData: Array<Buffer> = [];
  private talkbackStarted = false;
  private stopTalkbackTimeout?: NodeJS.Timeout;

  private targetStream?: Writable;

  private talkbackStartedHandle = (station: Station, device: Device, stream: Writable) => {
    this.onTalkbackStarted(station, device, stream);
  };

  private talkbackStoppedHandle = (station: Station, device: Device) => {
    this.onTalkbackStopped(station, device);
  };

  constructor(platform: EufySecurityPlatform, camera: Device) {
    super();

    this.platform = platform;
    this.camera = camera;

    this.platform.eufyClient.on('station talkback start', this.talkbackStartedHandle);
    this.platform.eufyClient.on('station talkback stop', this.talkbackStoppedHandle);
  }

  private onTalkbackStarted(station: Station, device: Device, stream: Writable) {
    if (device.getSerial() !== this.camera.getSerial()) {
      return;
    }

    this.platform.log.debug(this.camera.getName(), 'talkback started event from station ' + station.getName());

    if (this.targetStream) {
      this.unpipe(this.targetStream);
    }

    this.targetStream = stream;
    this.pipe(this.targetStream);
  }

  private onTalkbackStopped(station: Station, device: Device) {
    if (device.getSerial() !== this.camera.getSerial()) {
      return;
    }

    this.platform.log.debug(this.camera.getName(), 'talkback stopped event from station ' + station.getName());

    if (this.targetStream) {
      this.unpipe(this.targetStream);
    }
    this.targetStream = undefined;
  }

  public stopTalkbackStream(): void {
    // remove event listeners
    this.platform.eufyClient.removeListener('station talkback start', this.talkbackStartedHandle);
    this.platform.eufyClient.removeListener('station talkback stop', this.talkbackStoppedHandle);

    this.stopTalkback();
    this.unpipe();
    this.destroy();
  }

  override _read(size: number): void {
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
      this.platform.log.debug(this.camera.getName(), 'starting talkback');
      this.platform.eufyClient.startStationTalkback(this.camera.getSerial())
        .catch(err => {
          this.platform.log.error(this.camera.getName(), 'talkback could not be started: ' + err);
        });
    }
  }

  private stopTalkback() {
    if (this.talkbackStarted) {
      this.talkbackStarted = false;
      this.platform.log.debug(this.camera.getName(), 'stopping talkback');
      this.platform.eufyClient.stopStationTalkback(this.camera.getSerial())
        .catch(err => {
          this.platform.log.error(this.camera.getName(), 'talkback could not be stopped: ' + err);
        });
    }
  }
}