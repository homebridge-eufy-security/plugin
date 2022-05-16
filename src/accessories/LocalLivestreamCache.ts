import { EventEmitter, Readable } from 'stream';

import { Station, Device, StreamMetadata, Camera } from 'eufy-security-client';

import { EufySecurityPlatform } from '../platform';
import { Logger } from './logger';

export type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
};

export class LocalLivestreamCache extends EventEmitter {
  
  private readonly SECONDS_UNTIL_TERMINATION_AFTER_LAST_USER = 45;

  private stationStream: StationStream | null;
  private log: Logger;

  private connectionTimeout?: NodeJS.Timeout;
  private terminationTimeout?: NodeJS.Timeout;

  private numberOfLivestreamInstances: number;
  private livestreamStartedAt: number | null;
  
  private readonly platform: EufySecurityPlatform;
  private readonly device: Camera;
  
  constructor(platform: EufySecurityPlatform, device: Camera, log: Logger) {    
    super();

    this.log = log;
    this.platform = platform;
    this.device = device;

    this.stationStream = null;
    this.numberOfLivestreamInstances = 0;
    this.livestreamStartedAt = null;

    this.initialize();

    this.platform.eufyClient.on('station livestream stop', (station: Station, device: Device) => {
      this.onStationLivestreamStop(station, device);
    });
    this.platform.eufyClient.on('station livestream start',
      (station: Station, device: Device, metadata: StreamMetadata, videostream: Readable, audiostream: Readable) => {
        this.onStationLivestreamStart(station, device, metadata, videostream, audiostream);
      });
  }

  private initialize() {
    this.stationStream = null;
    this.numberOfLivestreamInstances = 0;
    this.livestreamStartedAt = null;

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
    }
    if (this.terminationTimeout) {
      clearTimeout(this.terminationTimeout);
    }
  }

  public async getLocalLivestream(): Promise<StationStream> {
    this.numberOfLivestreamInstances++;
    this.log.debug('New instance requests livestream from cache. There are currently ' +
                    this.numberOfLivestreamInstances + ' instance(s) using the livestream.');
    if (this.terminationTimeout) {
      clearTimeout(this.terminationTimeout);
    }
    if (this.stationStream) {
      const runtime = (Date.now() - this.livestreamStartedAt!) / 1000;
      this.log.debug('Using livestream that was started ' + runtime + ' ago.');
      return this.stationStream;
    } else {
      this.log.debug('No cached livestream. Start and cache new livestream...');
      return await this.startAndGetLocalLiveStream();
    }
  }

  public releaseLivestream(): void {
    this.numberOfLivestreamInstances--;
    this.log.debug('One instance released livestream. There are currently ' +
                    this.numberOfLivestreamInstances + ' instance(s) using the livestream.');
    if(this.numberOfLivestreamInstances <= 0) {
      this.log.debug('All livestream instances have disconnected.');
      // check if minimum remaining livestream duration is more than 20 percent
      // of maximum streaming duration or at least 20 seconds
      // if so the termination of the livestream is scheduled
      // if a new livestream is initiated in that time (e.g. fetching a snapshot)
      // the cached livestream can be used
      const maxStreamingDuration = this.platform.eufyClient.getCameraMaxLivestreamDuration();
      const runtime = (Date.now() - ((this.livestreamStartedAt !== null) ? this.livestreamStartedAt! : Date.now())) / 1000;
      if (((maxStreamingDuration - runtime) > maxStreamingDuration*0.2) && (maxStreamingDuration - runtime) > 20) {
        this.log.debug('Sufficient remaining livestream duration available. Schedule livestream termination in ' +
                      this.SECONDS_UNTIL_TERMINATION_AFTER_LAST_USER + ' seconds.');
        if (this.terminationTimeout) {
          clearTimeout(this.terminationTimeout);
        }
        this.terminationTimeout = setTimeout(() => {
          if (this.numberOfLivestreamInstances <= 0) {
            this.stopLocalLiveStream();
          }
        }, this.SECONDS_UNTIL_TERMINATION_AFTER_LAST_USER * 1000);
      } else {
        // stop livestream immediately
        this.log.debug('Not enough remaining livestream duration. Emptying livestream cache.');
        this.stopLocalLiveStream();
      }
    }
  }
  
  private async startAndGetLocalLiveStream(): Promise<StationStream> {
    return new Promise((resolve, reject) => {
      this.platform.eufyClient.startStationLivestream(this.device.getSerial());
      this.once('livestream start', () => {
        if (this.stationStream) {
          resolve(this.stationStream);
        } else {
          reject('no started livestream found');
        }
      });
    });
  }

  private stopLocalLiveStream(): void {
    this.log.debug('Stopping livestream.');
    this.platform.eufyClient.stopStationLivestream(this.device.getSerial());
  }

  private onStationLivestreamStop(station: Station, device: Device) {
    if (device.getSerial() === this.device.getSerial()) {
      this.log.info(station.getName() + ' livestream for ' + device.getName() + ' has stopped.');
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
      this.log.info(station.getName() + ' livestream for ' + device.getName() + ' has started.');
      this.livestreamStartedAt = Date.now();
      this.stationStream = {station, device, metadata, videostream, audiostream};
      
      this.emit('livestream start');
    }
  }

}