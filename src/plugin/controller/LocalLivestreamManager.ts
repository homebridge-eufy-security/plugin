/* eslint-disable max-len */
import { EventEmitter, Readable } from 'stream';
import { Station, Device, StreamMetadata, EufySecurity } from 'eufy-security-client';
import { log } from '../utils/utils';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { ILogObj, Logger } from 'tslog';

// Define a type for the station stream data.
type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
  createdAt: number;
};

// This class extends Readable to serve as an audio stream proxy
class AudiostreamProxy extends Readable {
  private cacheData: Buffer[] = [];
  private pushNewDataImmediately = false;
  private dataFramesCount = 0;

  constructor() {
    super();
  }

  // Method to transmit data to the readable stream
  private transmitData(data: Buffer | undefined): boolean {
    this.dataFramesCount++;
    return this.push(data);
  }

  // Method to add new audio data to the cache
  public newAudioData(data: Buffer): void {
    if (this.pushNewDataImmediately) {
      this.transmitData(data);
      this.pushNewDataImmediately = false;
    } else {
      this.cacheData.push(data);
    }
  }

  // Method to stop the proxy stream
  public stopProxyStream(): void {
    log.debug(`Audiostream was stopped after transmission of ${this.dataFramesCount} data chunks.`);
    this.unpipe();
    this.destroy();
  }

  // _read method to handle the reading operation
  override _read(): void {
    let pushReturn = true;
    while (this.cacheData.length && pushReturn) {
      const data = this.cacheData.shift();
      pushReturn = this.transmitData(data);
    }
    if (pushReturn) {
      this.pushNewDataImmediately = true;
    }
  }
}

// This class extends Readable to serve as a video stream proxy
class VideostreamProxy extends Readable {
  private manager: LocalLivestreamManager;
  private livestreamId: number;
  private cacheData: Buffer[] = [];
  private killTimeout: NodeJS.Timeout | null = null;
  private pushNewDataImmediately = false;
  private dataFramesCount = 0;

  constructor(id: number, manager: LocalLivestreamManager) {
    super();
    this.livestreamId = id;
    this.manager = manager;
    this.resetKillTimeout();
  }

  // Method to transmit data to the readable stream
  private transmitData(data: Buffer | undefined): boolean {
    this.dataFramesCount++;
    return this.push(data);
  }

  // Method to add new video data to the cache
  public newVideoData(data: Buffer): void {
    this.pushNewDataImmediately && this.resetPushFlagAndTransmit(data);
    this.cacheData.push(data);
  }

  // Method to stop the proxy stream
  public stopProxyStream(): void {
    log.debug(`Videostream was stopped after transmission of ${this.dataFramesCount} data chunks.`);
    this.unpipe();
    this.destroy();
    this.killTimeout && clearTimeout(this.killTimeout);
  }

  // Reset the kill timeout
  private resetKillTimeout(): void {
    this.killTimeout && clearTimeout(this.killTimeout);
    this.killTimeout = setTimeout(this.terminateStream, 15000);
  }

  // Terminate the stream due to inactivity
  private terminateStream = () => {
    log.warn(`Proxy Stream (id: ${this.livestreamId}) was terminated due to inactivity.`);
    this.manager.stopProxyStream(this.livestreamId);
  };

  // _read method to handle the reading operation
  override _read(): void {
    this.resetKillTimeout();
    let pushReturn = true;
    while (this.cacheData.length && pushReturn) {
      const data = this.cacheData.shift();
      pushReturn = this.transmitData(data);
    }
    pushReturn && (this.pushNewDataImmediately = true);
  }

  // Reset push flag and transmit data, handling exceptions
  private resetPushFlagAndTransmit(data: Buffer): void {
    try {
      this.transmitData(data) && this.resetKillTimeout();
    } catch (err) {
      log.debug(`Push unsuccessful. Likely target process was terminated. Error: ${err}`);
    }
    this.pushNewDataImmediately = false;
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
  private readonly CONNECTION_ESTABLISHED_TIMEOUT = 5;

  private stationStream: StationStream | null = null;
  private livestreamCount = 1;
  private proxyStreams: Set<ProxyStream> = new Set<ProxyStream>();
  private connectionTimeout?: NodeJS.Timeout;
  private terminationTimeout?: NodeJS.Timeout;
  private livestreamStartedAt: number | null = null;
  private livestreamIsStarting = false;
  private eufyClient: EufySecurity;

  public readonly log: Logger<ILogObj>;

  private readonly serial_number: string;

  constructor(
    camera: CameraAccessory,
  ) {
    super();
    this.eufyClient = camera.platform.eufyClient;

    this.serial_number = camera.device.getSerial();
    this.log = camera.log;

    this.initialize();

    this.eufyClient.on('station livestream start', this.onStationLivestreamStart.bind(this));
    this.eufyClient.on('station livestream stop', this.onStationLivestreamStop.bind(this));
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
    this.log.debug(`New instance requests livestream. There were ${this.proxyStreams.size} instance(s) using the livestream until now.`);
    if (this.terminationTimeout) {
      clearTimeout(this.terminationTimeout);
    }
    const proxyStream = await this.getProxyStream();
    if (proxyStream) {
      const runtime = (Date.now() - this.livestreamStartedAt!) / 1000;
      this.log.debug(
        `Using livestream that was started ${runtime} seconds ago. The proxy stream has id: ${proxyStream.id}.`);
      return proxyStream;
    } else {
      return await this.startAndGetLocalLiveStream();
    }
  }

  // Start and get the local livestream.
  private async startAndGetLocalLiveStream(): Promise<ProxyStream> {
    return new Promise((resolve, reject) => {
      this.log.debug('Start new station livestream (P2P Session)...');
      if (!this.livestreamIsStarting) { // prevent multiple stream starts from eufy station
        this.livestreamIsStarting = true;
        this.eufyClient.startStationLivestream(this.serial_number);
      } else {
        this.log.debug('stream is already starting. waiting...');
      }

      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
      }
      this.connectionTimeout = setTimeout(() => {
        this.livestreamIsStarting = false;
        this.log.error('Local livestream didn\'t start in time. Abort livestream request.');
        reject('no started livestream found');
      }, this.CONNECTION_ESTABLISHED_TIMEOUT * 2000);

      this.once('livestream start', async () => {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
        }
        const proxyStream = await this.getProxyStream();
        if (proxyStream !== null) {
          this.log.debug(`New livestream started. Proxy stream has id: ${proxyStream.id}.`);
          this.livestreamIsStarting = false;
          resolve(proxyStream);
        } else {
          reject('no started livestream found');
        }
      });
    });
  }

  // Stop the local livestream.
  public stopLocalLiveStream(): void {
    this.log.debug('Stopping station livestream.');
    this.eufyClient.stopStationLivestream(this.serial_number);
    this.initialize();
  }

  // Handle the station livestream stop event.
  private onStationLivestreamStop(station: Station, device: Device) {
    if (device.getSerial() === this.serial_number) {
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
    if (device.getSerial() === this.serial_number) {
      if (this.stationStream) {
        const diff = (Date.now() - this.stationStream.createdAt) / 1000;
        if (diff < 5) {
          this.log.warn('Second livestream was started from station. Ignore.');
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
        this.log.error(`Local videostream had Error: ${error}`);
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });
      videostream.on('end', () => {
        this.log.debug('Local videostream has ended. Clean up.');
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });

      audiostream.on('data', (data) => {
        this.proxyStreams.forEach((proxyStream) => {
          proxyStream.audiostream.newAudioData(data);
        });
      });
      audiostream.on('error', (error) => {
        this.log.error(`Local audiostream had Error: ${error}`);
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });
      audiostream.on('end', () => {
        this.log.debug('Local audiostream has ended. Clean up.');
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });

      this.log.info(`${station.getName()} station livestream (P2P session) for ${device.getName()} has started.`);
      this.livestreamStartedAt = Date.now();
      const createdAt = Date.now();
      this.stationStream = { station, device, metadata, videostream, audiostream, createdAt };
      this.log.debug('Stream metadata: ' + JSON.stringify(this.stationStream.metadata));

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
      const videostream = new VideostreamProxy(id, this);
      const audiostream = new AudiostreamProxy();
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

      this.log.debug(`One stream instance (id: ${id}) released livestream. There are now ${this.proxyStreams.size} instance(s) using the livestream.`);
      if (this.proxyStreams.size === 0) {
        this.log.debug('All proxy instances to the livestream have terminated.');
        this.stopLocalLiveStream();
      }
    }
  }
}