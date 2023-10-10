/* eslint-disable max-len */
import { EventEmitter, Readable } from 'stream';
import { Station, Device, StreamMetadata, Camera, EufySecurity } from '@homebridge-eufy-security/eufy-security-client';
import { EufySecurityPlatform } from '../platform';
import { Logger as TsLogger, ILogObj } from 'tslog';
import { CameraAccessory } from '../accessories/CameraAccessory';

// Define a type for the station stream data.
export type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
  createdAt: number;
};

// Define a class for the local livestream manager.
export class LocalLivestreamManager extends EventEmitter {

  private readonly platform: EufySecurityPlatform = this.camera.platform;
  private readonly device: Camera = this.camera.device;
  private readonly log: TsLogger<ILogObj> = this.platform.log;
  private readonly eufyClient: EufySecurity = this.platform.eufyClient;

  private stationStream: StationStream | null = null;
  private livestreamStartedAt: number | null = null;
  private livestreamIsStarting = false;

  constructor(
    private readonly camera: CameraAccessory,
  ) {
    super();
    this.initialize();
    this.eufyClient.on('station livestream stop', this.onStationLivestreamStop.bind(this));
    this.eufyClient.on('station livestream start', this.onStationLivestreamStart.bind(this));
  }

  // Initialize the manager.
  private initialize() {
    if (this.stationStream) {
      this.stationStream.audiostream.unpipe();
      this.stationStream.audiostream.destroy();
      this.stationStream.videostream.unpipe();
      this.stationStream.videostream.destroy();
    }
    this.stationStream = null;
    this.livestreamStartedAt = null;
  }

  // Get the local livestream.
  public async getLocalLivestream(): Promise<StationStream> {
    this.log.debug(`${this.device.getName()} New instance requests livestream.`);
    if (this.stationStream) {
      const runtime = (Date.now() - this.livestreamStartedAt!) / 1000;
      this.log.debug(
        this.device.getName(),
        `Using livestream that was started ${runtime} seconds ago.`);
      return this.stationStream;
    } else {
      return await this.startAndGetLocalLiveStream();
    }
  }

  // Start and get the local livestream.
  private async startAndGetLocalLiveStream(): Promise<StationStream> {
    return new Promise((resolve, reject) => {
      this.log.debug(this.device.getName(), 'Start new station livestream...');
      if (!this.livestreamIsStarting) { // prevent multiple stream starts from eufy station
        this.livestreamIsStarting = true;
        this.eufyClient.startStationLivestream(this.device.getSerial());
      } else {
        this.log.debug(this.device.getName(), 'stream is already starting. waiting...');
      }

      this.once('livestream start', async () => {
        if (this.stationStream !== null) {
          this.log.debug(this.device.getName(), 'New livestream started.');
          this.livestreamIsStarting = false;
          resolve(this.stationStream);
        } else {
          reject('no started livestream found');
        }
      });
    });
  }

  // Stop the local livestream.
  public stopLocalLiveStream(): void {
    this.log.debug(this.device.getName(), 'Stopping station livestream.');
    this.eufyClient.stopStationLivestream(this.device.getSerial());
    this.initialize();
  }

  // Handle the station livestream stop event.
  private onStationLivestreamStop(station: Station, device: Device) {
    if (device.getSerial() === this.device.getSerial()) {
      this.log.info(`${station.getName()} station livestream for ${device.getName()} has stopped.`);
      this.initialize();
    }
  }

  // Handle the station livestream start event.
  private async onStationLivestreamStart(
    station: Station,
    device: Device,
    metadata: StreamMetadata,
    videostream: Readable,
    audiostream: Readable,
  ) {
    if (device.getSerial() === this.camera.SN) {
      if (this.stationStream) {
        const diff = (Date.now() - this.stationStream.createdAt) / 1000;
        if (diff < 5) {
          this.log.warn(this.device.getName(), 'Second livestream was started from station. Ignore.');
          return;
        }
      }
      this.initialize(); // important to prevent unwanted behavior when the eufy station emits the 'livestream start' event multiple times

      this.log.info(`${station.getName()} station livestream (P2P session) for ${device.getName()} has started.`);
      this.livestreamStartedAt = Date.now();
      const createdAt = Date.now();
      this.stationStream = { station, device, metadata, videostream, audiostream, createdAt };
      this.log.debug(this.device.getName(), 'Stream metadata: ' + JSON.stringify(this.stationStream.metadata));

      this.emit('livestream start');
    }
  }
}