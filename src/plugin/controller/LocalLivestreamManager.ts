import { EventEmitter, Readable } from 'stream';

import { Station, Device, StreamMetadata, Camera } from 'eufy-security-client';

import { EufySecurityPlatform } from '../platform';
import { Logger as TsLogger, ILogObj } from 'tslog';
import { StreamingDelegate } from './streamingDelegate';

export type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
  createdAt: number;
};

export class LocalLivestreamManager extends EventEmitter {

  private stationStream: StationStream | null;

  private livestreamStartedAt: number | null;
  private livestreamIsStarting = false;

  private readonly platform: EufySecurityPlatform = this.streamingDelegate.platform;
  private readonly device: Camera = this.streamingDelegate.device;
  private log: TsLogger<ILogObj> = this.platform.log;

  constructor(
    private streamingDelegate: StreamingDelegate,
  ) {
    super();

    this.stationStream = null;
    this.livestreamStartedAt = null;

    this.initialize();

    this.platform.eufyClient.on('station livestream start',
      (station: Station, device: Device, metadata: StreamMetadata, videostream: Readable, audiostream: Readable) => {
        this.onStationLivestreamStart(station, device, metadata, videostream, audiostream);
      });

    this.platform.eufyClient.on('station livestream stop', (station: Station, device: Device) => {
      this.onStationLivestreamStop(station, device);
    });
  }

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

  public async getLocalLivestream(): Promise<StationStream> {
    this.log.debug(this.device.getName(), 'New instance requests livestream.');
    if (this.stationStream) {
      const runtime = (Date.now() - this.livestreamStartedAt!) / 1000;
      this.log.debug(this.device.getName(), 'Using livestream that was started ' + runtime + ' seconds ago.');
      return this.stationStream;
    } else {
      return await this.startAndGetLocalLiveStream();
    }
  }

  private async startAndGetLocalLiveStream(): Promise<StationStream> {
    return new Promise((resolve, reject) => {
      this.log.debug(this.device.getName(), 'Start new station livestream...');
      if (!this.livestreamIsStarting) { // prevent multiple stream starts from eufy station
        this.livestreamIsStarting = true;
        this.platform.eufyClient.startStationLivestream(this.device.getSerial());
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

  public stopLocalLiveStream(): void {
    this.log.debug(this.device.getName(), 'Stopping station livestream.');
    this.platform.eufyClient.stopStationLivestream(this.device.getSerial());
    this.initialize();
  }

  private onStationLivestreamStop(station: Station, device: Device) {
    if (device.getSerial() === this.device.getSerial()) {
      this.log.debug(station.getName() + ' station livestream for ' + device.getName() + ' has stopped.');
      this.initialize();
    }
  }

  private async onStationLivestreamStart(
    station: Station,
    device: Device,
    metadata: StreamMetadata,
    videostream: Readable,
    audiostream: Readable,
  ) {
    if (device.getSerial() === this.device.getSerial()) {
      if (this.stationStream) {
        const diff = (Date.now() - this.stationStream.createdAt) / 1000;
        if (diff < 5) {
          this.log.warn(this.device.getName(), 'Second livestream was started from station. Ignore.');
          return;
        }
      }
      this.initialize(); // important to prevent unwanted behaviour when the eufy station emits the 'livestream start' event multiple times

      this.log.debug(station.getName() + ' station livestream (P2P session) for ' + device.getName() + ' has started.');
      this.livestreamStartedAt = Date.now();
      const createdAt = Date.now();
      this.stationStream = { station, device, metadata, videostream, audiostream, createdAt };
      this.log.debug(this.device.getName(), 'Stream metadata: ' + JSON.stringify(this.stationStream.metadata));

      this.emit('livestream start');
    }
  }
}