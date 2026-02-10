import { EventEmitter, Readable } from 'stream';
import { Station, Device, StreamMetadata, EufySecurity, PropertyName } from 'eufy-security-client';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { ILogObj, Logger } from 'tslog';

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
  private stationStream: StationStream | null = null;

  private livestreamStartedAt: number | null = null;
  private livestreamIsStarting = false;

  private eufyClient: EufySecurity;
  public readonly log: Logger<ILogObj>;
  private readonly serial_number: string;

  constructor(
    private camera: CameraAccessory,
  ) {
    super();
    this.eufyClient = camera.platform.eufyClient;

    this.serial_number = camera.device.getSerial();
    this.log = camera.log;

    this.log.debug(`LocalLivestreamManager initialized for ${camera.device.getName()} (serial: ${this.serial_number})`);

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
  }

  // Get the local livestream.
  public async getLocalLivestream(): Promise<StationStream> {
    this.log.debug('New instance requests livestream.');
    if (this.stationStream) {
      const runtime = (Date.now() - this.livestreamStartedAt!) / 1000;
      this.log.debug('Using livestream that was started ' + runtime + ' seconds ago.');
      return this.stationStream;
    } else {
      return await this.startAndGetLocalLiveStream();
    }
  }

  // Start and get the local livestream.
  private async startAndGetLocalLiveStream(): Promise<StationStream> {
    return new Promise((resolve, reject) => {
      this.log.debug(`Start new station livestream for serial: ${this.serial_number}...`);
      if (!this.livestreamIsStarting) { // prevent multiple stream starts from eufy station
        this.livestreamIsStarting = true;
        this.log.debug(`Calling eufyClient.startStationLivestream('${this.serial_number}')...`);
        try {
          this.eufyClient.startStationLivestream(this.serial_number);
          this.log.debug('startStationLivestream call completed (awaiting P2P stream event).');
        } catch (err) {
          this.log.error(`startStationLivestream threw an error: ${err}`);
          this.livestreamIsStarting = false;
          reject(err);
          return;
        }
      } else {
        this.log.debug('stream is already starting. waiting...');
      }

      // Hard stop
      const startTime = Date.now();
      const hardStop = setTimeout(
        () => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          this.log.error(`Livestream timeout after ${elapsed}s: No 'station livestream start' event received for serial ${this.serial_number}.`);
          this.log.error(`This means the P2P connection to the station was not established or the station did not respond.`);
          this.log.debug(`livestreamIsStarting: ${this.livestreamIsStarting}, stationStream: ${this.stationStream !== null}`);
          const problematicNodeVersions = ['18.19.1', '20.11.1', '21.6.2'];
          this.log.warn(`If you are using Node.js version ${problematicNodeVersions.join(', ')} or newer, this might be related to RSA_PKCS1_PADDING support removal.`);
          this.log.warn('Please try enabling "Embedded PKCS1 Support" in the plugin settings to resolve this issue.');
          this.stopLocalLiveStream();
          this.livestreamIsStarting = false;
          reject('No livestream emitted... This may be due to Node.js compatibility issues. Try enabling Embedded PKCS1 Support in settings.');
        },
        15 * 1000 // After 15 seconds, Apple HomeKit may disconnect, invalidating the livestream setup.
      );

      this.once('livestream start', async () => {
        if (this.stationStream !== null) {
          this.log.debug('New livestream started.');
          clearTimeout(hardStop);
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
    this.log.debug('Stopping station livestream.');
    this.eufyClient.stopStationLivestream(this.serial_number);
    this.initialize();
  }

  // Handle the station livestream stop event.
  private onStationLivestreamStop(station: Station, device: Device) {
    if (device.getSerial() === this.serial_number) {
      this.log.debug(`${station.getName()} station livestream for ${device.getName()} has stopped.`);
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
    this.log.debug(`Received 'station livestream start' event - station: ${station.getName()}, ` +
      `device: ${device.getName()} (serial: ${device.getSerial()}), ` +
      `expected serial: ${this.serial_number}, match: ${device.getSerial() === this.serial_number}`);

    if (device.getSerial() === this.serial_number) {
      if (this.stationStream) {
        const diff = (Date.now() - this.stationStream.createdAt) / 1000;
        if (diff < 5) {
          this.log.warn('Second livestream was started from station. Ignore.');
          return;
        }
      }
      this.initialize(); // important to prevent unwanted behaviour when the eufy station emits the 'livestream start' event multiple times

      this.log.debug(station.getName() + ' station livestream (P2P session) for ' + device.getName() + ' has started.');
      this.livestreamStartedAt = Date.now();
      const createdAt = Date.now();
      this.stationStream = { station, device, metadata, videostream, audiostream, createdAt };
      this.log.debug('Stream metadata: ', JSON.stringify(this.stationStream.metadata));
      this.log.debug(`Video stream readable: ${videostream.readable}, Audio stream readable: ${audiostream.readable}`);

      this.emit('livestream start');
    }
  }
}