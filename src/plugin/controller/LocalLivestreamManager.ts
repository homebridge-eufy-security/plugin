/* eslint-disable max-len */
import { EventEmitter, Readable } from 'stream';
import { Station, Device, StreamMetadata, Camera } from 'eufy-security-client';
import { EufySecurityPlatform } from '../platform';
import { Logger as TsLogger, ILogObj } from 'tslog';

// Define a type for the station stream data.
type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
  createdAt: number;
};

// Define a class for the audio stream proxy.
class AudiostreamProxy extends Readable {
  private log: TsLogger<ILogObj>;
  private cacheData: Buffer[] = [];
  private pushNewDataImmediately = false;
  private dataFramesCount = 0;

  constructor(log: TsLogger<ILogObj>) {
    super();
    this.log = log;
  }

  // Transmit data to the readable stream.
  private transmitData(data: Buffer | undefined): boolean {
    this.dataFramesCount++;
    return this.push(data);
  }

  // Add new audio data to the cache.
  public newAudioData(data: Buffer): void {
    if (this.pushNewDataImmediately) {
      this.pushNewDataImmediately = false;
      this.transmitData(data);
    } else {
      this.cacheData.push(data);
    }
  }

  // Stop the proxy stream.
  public stopProxyStream(): void {
    this.log.debug(`Audiostream was stopped after transmission of ${this.dataFramesCount} data chunks.`);
    this.unpipe();
    this.destroy();
  }

  override _read(size: number): void {
    let pushReturn = true;
    while (this.cacheData.length > 0 && pushReturn) {
      const data = this.cacheData.shift();
      pushReturn = this.transmitData(data);
    }
    if (pushReturn) {
      this.pushNewDataImmediately = true;
    }
  }
}

// Define a class for the video stream proxy.
class VideostreamProxy extends Readable {
  private manager: LocalLivestreamManager;
  private livestreamId: number;
  private cacheData: Buffer[] = [];
  private log: TsLogger<ILogObj>;
  private killTimeout: NodeJS.Timeout | null = null;
  private pushNewDataImmediately = false;
  private dataFramesCount = 0;

  constructor(id: number, manager: LocalLivestreamManager, log: TsLogger<ILogObj>) {
    super();
    this.livestreamId = id;
    this.manager = manager;
    this.log = log;
    this.resetKillTimeout();
  }

  // Transmit data to the readable stream.
  private transmitData(data: Buffer | undefined): boolean {
    this.dataFramesCount++;
    return this.push(data);
  }

  // Add new video data to the cache.
  public newVideoData(data: Buffer): void {
    if (this.pushNewDataImmediately) {
      this.pushNewDataImmediately = false;
      try {
        if (this.transmitData(data)) {
          this.resetKillTimeout();
        }
      } catch (err) {
        this.log.debug(`Push of new data was not successful. Most likely the target process (ffmpeg) was already terminated. Error: ${err}`);
      }
    } else {
      this.cacheData.push(data);
    }
  }

  // Stop the proxy stream.
  public stopProxyStream(): void {
    this.log.debug(`Videostream was stopped after transmission of ${this.dataFramesCount} data chunks.`);
    this.unpipe();
    this.destroy();
    if (this.killTimeout) {
      clearTimeout(this.killTimeout);
    }
  }

  // Reset the kill timeout.
  private resetKillTimeout(): void {
    if (this.killTimeout) {
      clearTimeout(this.killTimeout);
    }
    this.killTimeout = setTimeout(() => {
      this.log.warn(`Proxy Stream (id: ${this.livestreamId}) was terminated due to inactivity. (no data transmitted in 15 seconds)`);
      this.manager.stopProxyStream(this.livestreamId);
    }, 15000);
  }

  override _read(size: number): void {
    this.resetKillTimeout();
    let pushReturn = true;
    while (this.cacheData.length > 0 && pushReturn) {
      const data = this.cacheData.shift();
      pushReturn = this.transmitData(data);
    }
    if (pushReturn) {
      this.pushNewDataImmediately = true;
    }
  }
}

// Define a type for the proxy stream.
type ProxyStream = {
  id: number;
  videostream: VideostreamProxy;
  audiostream: AudiostreamProxy;
};

// Define a class for the local livestream manager.
export class LocalLivestreamManager extends EventEmitter {
  private readonly SECONDS_UNTIL_TERMINATION_AFTER_LAST_USED = 45;
  private readonly CONNECTION_ESTABLISHED_TIMEOUT = 5;
  private stationStream: StationStream | null;
  private log: TsLogger<ILogObj>;
  private livestreamCount = 1;
  private proxyStreams: Set<ProxyStream> = new Set<ProxyStream>();
  private connectionTimeout?: NodeJS.Timeout;
  private terminationTimeout?: NodeJS.Timeout;
  private livestreamStartedAt: number | null;
  private livestreamIsStarting = false;
  private readonly platform: EufySecurityPlatform;
  private readonly device: Camera;

  constructor(platform: EufySecurityPlatform, device: Camera, log: TsLogger<ILogObj>) {
    super();
    this.log = log;
    this.platform = platform;
    this.device = device;
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
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
    }
  }

  // Get the local livestream.
  public async getLocalLivestream(): Promise<ProxyStream> {
    this.log.debug(`${this.device.getName()} New instance requests livestream. There were ${this.proxyStreams.size} instance(s) using the livestream until now.`);
    if (this.terminationTimeout) {
      clearTimeout(this.terminationTimeout);
    }
    const proxyStream = await this.getProxyStream();
    if (proxyStream) {
      const runtime = (Date.now() - this.livestreamStartedAt!) / 1000;
      this.log.debug(
        this.device.getName(),
        `Using livestream that was started ${runtime} seconds ago. The proxy stream has id: ${proxyStream.id}.`);
      return proxyStream;
    } else {
      return await this.startAndGetLocalLiveStream();
    }
  }

  // Start and get the local livestream.
  private async startAndGetLocalLiveStream(): Promise<ProxyStream> {
    return new Promise((resolve, reject) => {
      this.log.debug(this.device.getName(), 'Start new station livestream (P2P Session)...');
      if (!this.livestreamIsStarting) { // prevent multiple stream starts from eufy station
        this.livestreamIsStarting = true;
        this.platform.eufyClient.startStationLivestream(this.device.getSerial());
      } else {
        this.log.debug(this.device.getName(), 'stream is already starting. waiting...');
      }

      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
      }
      this.connectionTimeout = setTimeout(() => {
        this.livestreamIsStarting = false;
        this.log.error(this.device.getName(), 'Local livestream didn\'t start in time. Abort livestream request.');
        reject('no started livestream found');
      }, this.CONNECTION_ESTABLISHED_TIMEOUT * 2000);

      this.once('livestream start', async () => {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
        }
        const proxyStream = await this.getProxyStream();
        if (proxyStream !== null) {
          this.log.debug(this.device.getName(), `New livestream started. Proxy stream has id: ${proxyStream.id}.`);
          this.livestreamIsStarting = false;
          resolve(proxyStream);
        } else {
          reject('no started livestream found');
        }
      });
    });
  }

  // Schedule livestream cache termination.
  private scheduleLivestreamCacheTermination(streamingTimeLeft: number): void {
    const terminationTime = ((streamingTimeLeft - this.SECONDS_UNTIL_TERMINATION_AFTER_LAST_USED) > 20) ? this.SECONDS_UNTIL_TERMINATION_AFTER_LAST_USED : streamingTimeLeft - 20;
    this.log.debug(
      this.device.getName(),
      `Schedule livestream termination in ${terminationTime} seconds.`);
    if (this.terminationTimeout) {
      clearTimeout(this.terminationTimeout);
    }
    this.terminationTimeout = setTimeout(() => {
      if (this.proxyStreams.size <= 0) {
        this.stopLocalLiveStream();
      }
    }, terminationTime * 1000);
  }

  // Stop the local livestream.
  public stopLocalLiveStream(): void {
    this.log.debug(this.device.getName(), 'Stopping station livestream.');
    this.platform.eufyClient.stopStationLivestream(this.device.getSerial());
    this.initialize();
  }

  // Handle the station livestream stop event.
  private onStationLivestreamStop(station: Station, device: Device) {
    if (device.getSerial() === this.device.getSerial()) {
      this.log.info(`${station.getName()} station livestream for ${device.getName()} has stopped.`);
      this.proxyStreams.forEach((proxyStream) => {
        proxyStream.audiostream.stopProxyStream();
        proxyStream.videostream.stopProxyStream();
        this.removeProxyStream(proxyStream.id);
      });
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
    if (device.getSerial() === this.device.getSerial()) {
      if (this.stationStream) {
        const diff = (Date.now() - this.stationStream.createdAt) / 1000;
        if (diff < 5) {
          this.log.warn(this.device.getName(), 'Second livestream was started from station. Ignore.');
          return;
        }
      }
      this.initialize(); // important to prevent unwanted behavior when the eufy station emits the 'livestream start' event multiple times
      videostream.on('data', (data) => {
        this.proxyStreams.forEach((proxyStream) => {
          proxyStream.videostream.newVideoData(data);
        });
      });
      videostream.on('error', (error) => {
        this.log.error(this.device.getName(), `Local videostream had Error: ${error}`);
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });
      videostream.on('end', () => {
        this.log.debug(this.device.getName(), 'Local videostream has ended. Clean up.');
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });

      audiostream.on('data', (data) => {
        this.proxyStreams.forEach((proxyStream) => {
          proxyStream.audiostream.newAudioData(data);
        });
      });
      audiostream.on('error', (error) => {
        this.log.error(this.device.getName(), `Local audiostream had Error: ${error}`);
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });
      audiostream.on('end', () => {
        this.log.debug(this.device.getName(), 'Local audiostream has ended. Clean up.');
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });

      this.log.info(`${station.getName()} station livestream (P2P session) for ${device.getName()} has started.`);
      this.livestreamStartedAt = Date.now();
      const createdAt = Date.now();
      this.stationStream = { station, device, metadata, videostream, audiostream, createdAt };
      this.log.debug(this.device.getName(), 'Stream metadata: ' + JSON.stringify(this.stationStream.metadata));

      this.emit('livestream start');
    }
  }

  // Get a proxy stream.
  private getProxyStream(): ProxyStream | null {
    if (this.stationStream) {
      const id = this.livestreamCount;
      this.livestreamCount++;
      if (this.livestreamCount > 1024) {
        this.livestreamCount = 1;
      }
      const videostream = new VideostreamProxy(id, this, this.log);
      const audiostream = new AudiostreamProxy(this.log);
      const proxyStream = { id, videostream, audiostream };
      this.proxyStreams.add(proxyStream);
      return proxyStream;
    } else {
      return null;
    }
  }

  // Stop a proxy stream by ID.
  public stopProxyStream(id: number): void {
    this.proxyStreams.forEach((pStream) => {
      if (pStream.id === id) {
        pStream.audiostream.stopProxyStream();
        pStream.videostream.stopProxyStream();
        this.removeProxyStream(id);
      }
    });
  }

  // Stop all proxy streams.
  private stopAllProxyStreams(): void {
    this.proxyStreams.forEach((proxyStream) => {
      this.stopProxyStream(proxyStream.id);
    });
  }

  // Remove a proxy stream by ID.
  private removeProxyStream(id: number): void {
    let proxyStream: ProxyStream | null = null;
    this.proxyStreams.forEach((pStream) => {
      if (pStream.id === id) {
        proxyStream = pStream;
      }
    });
    if (proxyStream !== null) {
      this.proxyStreams.delete(proxyStream);

      this.log.debug(this.device.getName(), `One stream instance (id: ${id}) released livestream. There are now ${this.proxyStreams.size} instance(s) using the livestream.`);
      if (this.proxyStreams.size === 0) {
        this.log.debug(this.device.getName(), 'All proxy instances to the livestream have terminated.');
        this.stopLocalLiveStream();
      }
    }
  }
}
