import { Duplex, Writable } from 'stream';

import { EufySecurity, Device, Station } from 'eufy-security-client';

import { Logger } from './logger';

export class TalkbackStream extends Duplex {

  private log: Logger;
  private eufyClient: EufySecurity;
  private camera: Device;

  private cacheData: Array<Buffer> = [];
  private talkbackStarted = false;
  private stopTalkbackTimeout?: NodeJS.Timeout;

  private targetStream?: Writable;

  constructor(eufyClient: EufySecurity, camera: Device, log: Logger) {
    super();

    this.log = log;
    this.eufyClient = eufyClient;
    this.camera = camera;

    this.eufyClient.on('station talkback start', this.onTalkbackStarted.bind(this));
    this.eufyClient.on('station talkback stop', this.onTalkbackStopped.bind(this));
  }

  private onTalkbackStarted(station: Station, device: Device, stream: Writable) {
    if (device.getSerial() !== this.camera.getSerial()) {
      return;
    }

    this.log.debug(this.camera.getName(), 'talkback started event from station ' + station.getName());

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

    this.log.debug(this.camera.getName(), 'talkback stopped event from station ' + station.getName());

    if (this.targetStream) {
      this.unpipe(this.targetStream);
    }
    this.targetStream = undefined;
  }

  public stopTalkbackStream(): void {
    this.stopTalkback();
    this.unpipe();
    this.destroy(); // TODO: check if multiple talkbacks work
  }

  override _read(size: number): void {
    let pushReturn = true;
    while (this.cacheData.length > 0 && pushReturn) {
      const data = this.cacheData.shift();
      this.log.debug(this.camera.getName(),
        'sending cached audio data to camera. ' + this.cacheData.length + ' cached chunks of data left.');
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

    // TODO: remove chunk logging
    if (this.targetStream) {
      this.log.debug(this.camera.getName(), 'sending audio data to camera.');
      this.push(chunk);
    } else {
      this.log.debug(this.camera.getName(), 'caching audio data and starting talkback.');
      this.cacheData.push(chunk);
      this.startTalkback();
    }
    callback();
  }

  private startTalkback() {
    if (!this.talkbackStarted) {
      this.talkbackStarted = true;
      this.log.debug(this.camera.getName(), 'starting talkback');
      this.eufyClient.startStationTalkback(this.camera.getSerial())
        .catch(err => {
          this.log.error(this.camera.getName(), 'talkback could not be started: ' + err);
        });
    }
  }

  private stopTalkback() {
    if (this.talkbackStarted) {
      this.talkbackStarted = false;
      this.log.debug(this.camera.getName(), 'stopping talkback');
      this.eufyClient.stopStationTalkback(this.camera.getSerial())
        .catch(err => {
          this.log.error(this.camera.getName(), 'talkback could not be stopped: ' + err);
        });
    }
  }
}