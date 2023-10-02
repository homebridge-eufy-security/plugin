import { Duplex, Writable } from 'stream';
import { EufySecurityPlatform } from '../platform';
import { Device, Station } from 'eufy-security-client';

export class TalkbackStream extends Duplex {

  private cacheData: Array<Buffer> = [];
  private talkbackStarted = false;
  private stopTalkbackTimeout?: NodeJS.Timeout;
  private targetStream?: Writable;
  private cameraName: string;

  // Constructor
  constructor(
    private platform: EufySecurityPlatform,
    private camera: Device,
  ) {
    super();
    this.platform = platform;
    this.camera = camera;
    this.cameraName = this.camera.getName();
    this.platform.eufyClient.once('station talkback start', this.talkbackStartedHandle);
    this.platform.eufyClient.once('station talkback stop', this.talkbackStoppedHandle);
  }

  // Private method to handle the 'station talkback start' event
  private talkbackStartedHandle(station: Station, device: Device, stream: Writable) {
    this.onTalkbackStarted(station, device, stream);
  }

  // Private method to handle the 'station talkback stop' event
  private talkbackStoppedHandle(station: Station, device: Device) {
    this.onTalkbackStopped(station, device);
  }

  // Private method called when talkback is started
  private onTalkbackStarted(station: Station, device: Device, stream: Writable) {
    try {
      if (device.getSerial() !== this.camera.getSerial()) {
        this.platform.log.error(this.cameraName, 'mixing stream ' + station.getName());
        return;
      }
      this.platform.log.debug(this.cameraName, 'talkback started event from station ' + station.getName());
      this.clearTargetStream();
      this.targetStream = stream;
      this.pipe(this.targetStream);
    } catch (error) {
      this.platform.log.error(this.cameraName, 'Error during talkback start: ' + error);
    }
  }

  // Private method called when talkback is stopped
  private onTalkbackStopped(station: Station, device: Device) {
    if (device.getSerial() !== this.camera.getSerial()) {
      return;
    }
    this.platform.log.debug(this.cameraName, 'talkback stopped event from station ' + station.getName());
    this.clearTargetStream();
  }

  // Public method to stop the talkback stream
  public stopTalkbackStream(): void {
    this.platform.eufyClient.removeListener('station talkback start', this.talkbackStartedHandle);
    this.platform.eufyClient.removeListener('station talkback stop', this.talkbackStoppedHandle);
    this.stopTalkback();
    this.unpipe();
    this.destroy();
  }

  // Overridden _read method for reading data from the cache
  override _read(size: number): void {
    let pushReturn = true;
    while (this.cacheData.length > 0 && pushReturn) {
      const data = this.cacheData.shift();
      pushReturn = this.push(data);
    }
  }

  // Overridden _write method for writing data to the stream
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

  // Private method to start talkback
  private startTalkback() {
    if (!this.talkbackStarted) {
      this.talkbackStarted = true;
      this.platform.log.debug(this.cameraName, 'starting talkback');
      this.platform.eufyClient.startStationTalkback(this.camera.getSerial())
        .catch(err => {
          this.platform.log.error(this.cameraName, 'talkback could not be started: ' + err);
        });
    }
  }

  // Private method to stop talkback
  private stopTalkback() {
    if (this.talkbackStarted) {
      this.talkbackStarted = false;
      this.platform.log.debug(this.cameraName, 'stopping talkback');
      this.platform.eufyClient.stopStationTalkback(this.camera.getSerial())
        .catch(err => {
          this.platform.log.error(this.cameraName, 'talkback could not be stopped: ' + err);
        });
    }
  }

  // Private method for clearing the target stream
  private clearTargetStream() {
    if (this.targetStream) {
      this.unpipe(this.targetStream);
    }
    this.targetStream = undefined;
  }
}
