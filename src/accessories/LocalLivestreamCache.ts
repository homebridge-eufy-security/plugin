import { EventEmitter, Readable } from 'stream';

import { Station, Device, StreamMetadata, Camera } from 'eufy-security-client';

import { EufySecurityPlatform } from '../platform';
import { Logger } from './logger';

type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
};

class AudioCache extends Readable {

  private cacheData: Array<Buffer> = [];
  private pushNewDataImmediately = false;

  constructor() {
    super();
  }

  public newAudioData(data: Buffer): void {
    if (this.pushNewDataImmediately) {
      this.pushNewDataImmediately = false;
      this.push(data);
    } else {
      this.cacheData.push(data);
    }
  }

  public stopCachedStream(): void {
    this.unpipe();
    this.destroy();
  }

  _read(size: number): void {
    let pushReturn = true;
    while (this.cacheData.length > 0 && pushReturn) {
      const data = this.cacheData.shift();
      pushReturn = this.push(data);
    }
    if (pushReturn) {
      this.pushNewDataImmediately = true;
    }
  }
}

class VideoCache extends Readable {

  private cacheManager: LocalLivestreamCache;
  private livestreamId: number;

  private cacheData: Array<Buffer> = [];
  private log: Logger;

  private killTimeout: NodeJS.Timeout | null = null;

  private pushNewDataImmediately = false;

  constructor(id: number, cacheData: Array<Buffer>, manager: LocalLivestreamCache, log: Logger) {
    super();

    this.livestreamId = id;
    this.cacheManager = manager;
    this.cacheData = cacheData;
    this.log = log;
    this.resetKillTimeout();
  }

  public newVideoData(data: Buffer): void {

    if (this.pushNewDataImmediately) {
      this.pushNewDataImmediately = false;
      try {
        if(this.push(data)) {
          this.resetKillTimeout();
        }
      } catch (err) {
        this.log.debug('Push of new data was not succesful. Most likely the target process (ffmpeg) was already terminated. Error: ' + err);
      }
    } else {
      this.cacheData.push(data);
    }
  }

  public stopCachedStream(): void {
    this.unpipe();
    this.destroy();
    if (this.killTimeout) {
      clearTimeout(this.killTimeout);
    }
  }

  private resetKillTimeout(): void {
    if (this.killTimeout) {
      clearTimeout(this.killTimeout);
    }
    this.killTimeout = setTimeout(() => {
      this.log.warn('Cached Stream (id: ' + this.livestreamId + ') was terminated due to inactivity.');
      this.cacheManager.stopCachedStream(this.livestreamId);
    }, 15000);
  }

  _read(size: number): void {
    this.resetKillTimeout();
    let pushReturn = true;
    while (this.cacheData.length > 0 && pushReturn) {
      const data = this.cacheData.shift();
      pushReturn = this.push(data);
    }
    if (pushReturn) {
      this.pushNewDataImmediately = true;
    }
  }

}

type CachedStream = {
  id: number;
  videostream: VideoCache;
  audiostream: AudioCache;
};

export class LocalLivestreamCache extends EventEmitter {
  
  private readonly SECONDS_UNTIL_TERMINATION_AFTER_LAST_USED = 45;
  private readonly CONNECTION_ESTABLISHED_TIMEOUT = 5;

  private stationStream: StationStream | null;
  private log: Logger;

  private livestreamCount = 0;
  private iFrameCache: Array<Buffer> = [];

  private cachedStreams: Set<CachedStream> = new Set<CachedStream>();

  private cacheEnabled: boolean;

  private connectionTimeout?: NodeJS.Timeout;
  private terminationTimeout?: NodeJS.Timeout;

  private livestreamStartedAt: number | null;
  private livestreamIsStarting = false;
  
  private readonly platform: EufySecurityPlatform;
  private readonly device: Camera;
  
  constructor(platform: EufySecurityPlatform, device: Camera, cacheEnabled: boolean, log: Logger) {    
    super();

    this.log = log;
    this.platform = platform;
    this.device = device;

    this.cacheEnabled = cacheEnabled;
    if (this.cacheEnabled) {
      this.log.debug('Livestream caching for ' + this.device.getName() + ' is enabled.');
    }

    this.stationStream = null;
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
    if (this.stationStream) {
      this.stationStream.audiostream.unpipe();
      this.stationStream.audiostream.destroy();
      this.stationStream.videostream.unpipe();
      this.stationStream.videostream.destroy();
    }
    this.stationStream = null;
    this.iFrameCache = [];
    this.livestreamStartedAt = null;

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
    }
    if (this.terminationTimeout) {
      clearTimeout(this.terminationTimeout);
    }
  }

  public async getLocalLivestream(): Promise<CachedStream> {
    this.log.debug('New instance requests livestream. There were ' +
                    this.cachedStreams.size + ' instance(s) using the livestream until now.');
    if (this.terminationTimeout) {
      clearTimeout(this.terminationTimeout);
    }
    const cachedStream = await this.getCachedStream();
    if (cachedStream) {
      const runtime = (Date.now() - this.livestreamStartedAt!) / 1000;
      this.log.debug('Using livestream that was started ' + runtime + ' seconds ago. The cached stream has id: ' + cachedStream.id + '.');
      return cachedStream;
    } else {
      return await this.startAndGetLocalLiveStream();
    }
  }
  
  private async startAndGetLocalLiveStream(): Promise<CachedStream> {
    return new Promise((resolve, reject) => {
      this.log.debug('Start new local livestream...');
      if (!this.livestreamIsStarting) { // prevent multiple stream starts from eufy station
        this.livestreamIsStarting = true;
        this.platform.eufyClient.startStationLivestream(this.device.getSerial());
      }

      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
      }
      this.connectionTimeout = setTimeout(() => {
        this.livestreamIsStarting = false;
        this.log.error('Local livestream didn\'t start in time. Abort livestream cache request.');
        reject('no started livestream found');
      }, this.CONNECTION_ESTABLISHED_TIMEOUT * 1000);

      this.once('livestream start', async () => {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
        }
        const cachedStream = await this.getCachedStream();
        if (cachedStream !== null) {
          this.log.debug('New livestream started. Cached stream has id: ' + cachedStream.id + '.');
          this.livestreamIsStarting = false;
          resolve(cachedStream);
        } else {
          reject('no started livestream found');
        }
      });
    });
  }

  private scheduleLivestreamCacheTermination(): void {
    this.log.debug('Schedule livestream termination in ' + this.SECONDS_UNTIL_TERMINATION_AFTER_LAST_USED + ' seconds.');
    if (this.terminationTimeout) {
      clearTimeout(this.terminationTimeout);
    }
    this.terminationTimeout = setTimeout(() => {
      if (this.cachedStreams.size <= 0) {
        this.stopLocalLiveStream();
      }
    }, this.SECONDS_UNTIL_TERMINATION_AFTER_LAST_USED * 1000);
  }

  public stopLocalLiveStream(): void {
    this.log.debug('Stopping local livestream.');
    this.platform.eufyClient.stopStationLivestream(this.device.getSerial());
  }

  private onStationLivestreamStop(station: Station, device: Device) {
    if (device.getSerial() === this.device.getSerial()) {
      this.log.info(station.getName() + ' livestream for ' + device.getName() + ' has stopped.');
      this.cachedStreams.forEach((cachedStream) => {
        cachedStream.audiostream.stopCachedStream();
        cachedStream.videostream.stopCachedStream();
        this.removeCachedStream(cachedStream.id);
      });
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
      this.initialize(); // important to prevent unwanted behaviour when the eufy station emits the 'livestream start' event multiple times
      // TODO: events for error, close, etc.
      videostream.on('data', (data) => {
        if(this.isIFrame(data)) { // cache iFrames to speed up livestream encoding
          this.iFrameCache = [data];
        } else if (this.iFrameCache.length > 0) {
          this.iFrameCache.push(data);
        }

        this.cachedStreams.forEach((cachedStream) => {
          cachedStream.videostream.newVideoData(data);
        });
      });
      audiostream.on('data', (data) => {       
        this.cachedStreams.forEach((cachedStream) => {
          cachedStream.audiostream.newAudioData(data);
        });
      });

      this.log.info(station.getName() + ' livestream for ' + device.getName() + ' has started.');
      this.livestreamStartedAt = Date.now();
      this.stationStream = {station, device, metadata, videostream, audiostream};
      this.log.debug('Stream metadata: ' + JSON.stringify(this.stationStream.metadata));
      
      this.emit('livestream start');
    }
  }

  private getCachedStream(): CachedStream | null {
    if (this.stationStream) {
      const id = this.livestreamCount;
      this.livestreamCount++;
      if (this.livestreamCount > 1024) {
        this.livestreamCount = 0;
      }
      const videostream = new VideoCache(id, this.iFrameCache, this, this.log);
      const audiostream = new AudioCache();
      const cachedStream = { id, videostream, audiostream };
      this.cachedStreams.add(cachedStream);
      return cachedStream;
    } else {
      return null;
    }
  }

  public stopCachedStream(id: number): void {
    this.cachedStreams.forEach((cStream) => {
      if (cStream.id === id) {
        cStream.audiostream.stopCachedStream();
        cStream.videostream.stopCachedStream();
        this.removeCachedStream(id);
      }
    });
  }

  private removeCachedStream(id: number): void {
    let cachedStream: CachedStream | null = null;
    this.cachedStreams.forEach((cStream) => {
      if (cStream.id === id) {
        cachedStream = cStream;
      }
    });
    if (cachedStream !== null) {
      this.cachedStreams.delete(cachedStream);

      this.log.debug('One cached instance (id: ' + id + ') released livestream. There are now ' +
                    this.cachedStreams.size + ' instance(s) using the livestream.');
      if(this.cachedStreams.size === 0) {
        this.log.debug('All cached instances have terminated.');
        // check if minimum remaining livestream duration is more than 20 percent
        // of maximum streaming duration or at least 20 seconds
        // if so the termination of the livestream is scheduled
        // if a new livestream is initiated in that time (e.g. fetching a snapshot)
        // the cached livestream can be used
        // caching must also be enabled of course
        const maxStreamingDuration = this.platform.eufyClient.getCameraMaxLivestreamDuration();
        const runtime = (Date.now() - ((this.livestreamStartedAt !== null) ? this.livestreamStartedAt! : Date.now())) / 1000;
        if (((maxStreamingDuration - runtime) > maxStreamingDuration*0.2) && (maxStreamingDuration - runtime) > 20 && this.cacheEnabled) {
          this.log.debug('Sufficient remaining livestream duration available.');
          this.scheduleLivestreamCacheTermination();
        } else {
          // stop livestream immediately
          if (this.cacheEnabled) {
            this.log.debug('Not enough remaining livestream duration. Emptying livestream cache.');
          }
          this.stopLocalLiveStream();
        }
      }
    }
  }

  private isIFrame(data: Buffer): boolean {
    const validValues = [64, 66, 68, 78, 101, 103];
    if (data !== undefined && data.length > 0) {
      if (data.length >= 5) {
        const startcode = [...data.slice(0, 5)];
        if (validValues.includes(startcode[3]) || validValues.includes(startcode[4])) {
          return true;
        }
      }
    }
    return false;
  }
}