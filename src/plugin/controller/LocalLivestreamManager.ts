import { EventEmitter, Readable } from 'stream';
import { Station, Device, StreamMetadata, EufySecurity } from 'eufy-security-client';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { ILogObj, Logger } from 'tslog';
import { hasNativePKCS1Support, getProblematicNodeVersions } from '../utils/pkcs1-support';

// Define a type for the station stream data.
type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
  createdAt: number;
};

// Define a class for the local livestream manager.
export class LocalLivestreamManager extends EventEmitter {
  private readonly CONNECTION_ESTABLISHED_TIMEOUT = 5;

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
      this.log.debug('Start new station livestream...');
      if (!this.livestreamIsStarting) { // prevent multiple stream starts from eufy station
        this.livestreamIsStarting = true;
        this.eufyClient.startStationLivestream(this.serial_number);
      } else {
        this.log.debug('stream is already starting. waiting...');
      }

      // Hard stop
      const hardStop = setTimeout(
        () => {
          this.log.error('Livestream timeout: No livestream emitted within the expected timeframe.');
          
          const nativePKCS1Support = hasNativePKCS1Support();
          const problematicNodeVersions = getProblematicNodeVersions();
          const currentNodeVersion = process.version;
          const currentOpenSSLVersion = process.versions.openssl;
          
          this.log.debug(`Current Node.js version: ${currentNodeVersion}, OpenSSL version: ${currentOpenSSLVersion}`);
          this.log.debug(`Native PKCS1 support detected: ${nativePKCS1Support}`);
          
          if (!nativePKCS1Support) {
            this.log.warn(`Node.js version ${currentNodeVersion} with problematic PKCS1 support detected (problematic versions: ${problematicNodeVersions.join(', ')}).`);
            this.log.warn('This might be related to RSA_PKCS1_PADDING support removal in your Node.js version.');
            this.log.warn('Please try enabling "Embedded PKCS1 Support" in the plugin settings to resolve this issue.');
          } else {
            this.log.warn(`Node.js version ${currentNodeVersion} with OpenSSL ${currentOpenSSLVersion} should support PKCS1 natively.`);
            this.log.warn('If you have "Embedded PKCS1 Support" enabled, consider disabling it for better performance.');
            this.log.warn('This livestream timeout might be due to network connectivity, device issues, or other factors.');
          }
          
          this.stopLocalLiveStream();
          this.livestreamIsStarting = false;
          
          const errorMessage = nativePKCS1Support 
            ? 'No livestream emitted... This might be due to network or device issues rather than Node.js compatibility.'
            : 'No livestream emitted... This may be due to Node.js compatibility issues. Try enabling Embedded PKCS1 Support in settings.';
            
          reject(errorMessage);
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
      this.log.debug('Stream metadata: ', this.stationStream.metadata);

      this.emit('livestream start');
    }
  }
}