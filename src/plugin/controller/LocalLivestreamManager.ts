import { EventEmitter, Readable } from 'stream';
import { Station, Device, StreamMetadata, EufySecurity } from 'eufy-security-client';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { ILogObj, Logger } from 'tslog';

/**
 * Represents a stream connection to an Eufy station
 */
type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
  createdAt: number;
};

/**
 * Manages local livestream connections to Eufy cameras
 * Handles starting, stopping, and reusing stream connections
 */
export class LocalLivestreamManager extends EventEmitter {
  // Configuration
  private readonly CONNECTION_TIMEOUT_SECONDS = 15;
  private readonly MIN_STREAM_REUSE_SECONDS = 5;

  // State tracking
  private stationStream: StationStream | null = null;
  private livestreamStartedAt: number | null = null;
  private livestreamIsStarting = false;

  // Dependencies
  private eufyClient: EufySecurity;
  public readonly log: Logger<ILogObj>;
  private readonly serialNumber: string;

  constructor(private camera: CameraAccessory) {
    super();
    
    this.eufyClient = camera.platform.eufyClient;
    this.serialNumber = camera.device.getSerial();
    this.log = camera.log;

    // Initialize manager
    this.setupEventListeners();
  }

  /**
   * Set up event listeners for Eufy client events
   */
  private setupEventListeners(): void {
    this.eufyClient.on('station livestream start', this.onStationLivestreamStart.bind(this));
    this.eufyClient.on('station livestream stop', this.onStationLivestreamStop.bind(this));
  }

  /**
   * Get an active livestream or start a new one
   */
  public async getLocalLivestream(): Promise<StationStream> {
    this.log.debug('New instance requests livestream.');
    
    if (this.hasUsableExistingStream()) {
      const runtime = this.getStreamRuntime();
      this.log.debug(`Using existing livestream (running for ${runtime.toFixed(1)} seconds)`);
      return this.stationStream!;
    } else {
      return this.startAndGetLocalLiveStream();
    }
  }

  /**
   * Check if we have a usable existing stream
   */
  private hasUsableExistingStream(): boolean {
    return !!this.stationStream && !!this.livestreamStartedAt;
  }

  /**
   * Get runtime of current stream in seconds
   */
  private getStreamRuntime(): number {
    return this.livestreamStartedAt ? (Date.now() - this.livestreamStartedAt) / 1000 : 0;
  }

  /**
   * Start a new livestream and return it
   */
  private async startAndGetLocalLiveStream(): Promise<StationStream> {
    return new Promise((resolve, reject) => {
      this.log.debug('Starting new station livestream...');
      
      // Prevent multiple simultaneous start attempts
      if (!this.livestreamIsStarting) {
        this.livestreamIsStarting = true;
        this.eufyClient.startStationLivestream(this.serialNumber);
      } else {
        this.log.debug('Stream is already starting, waiting for completion...');
      }

      // Set up timeout for stream start
      const hardStop = setTimeout(() => {
        this.handleStreamStartTimeout(reject);
      }, this.CONNECTION_TIMEOUT_SECONDS * 1000);

      // Set up success handler
      this.once('livestream start', () => {
        if (this.stationStream) {
          this.log.debug('New livestream started successfully');
          clearTimeout(hardStop);
          this.livestreamIsStarting = false;
          resolve(this.stationStream);
        } else {
          reject(new Error('No started livestream found'));
        }
      });
    });
  }

  /**
   * Handle timeout when starting a stream
   */
  private handleStreamStartTimeout(reject: (reason: any) => void): void {
    const errorMessage = 'Livestream timeout: No livestream emitted within the expected timeframe.';
    this.log.error(errorMessage);
    
    // Check for compatibility issues with recent Node.js versions
    const problematicNodeVersions = ['18.19.1', '20.11.1', '21.6.2'];
    this.log.warn(`If you are using Node.js version ${problematicNodeVersions.join(', ')} or newer, this might be related to RSA_PKCS1_PADDING support removal.`);
    this.log.warn('Please try enabling "Embedded PKCS1 Support" in the plugin settings to resolve this issue.');
    
    this.stopLocalLiveStream();
    this.livestreamIsStarting = false;
    reject(new Error('No livestream emitted... This may be due to Node.js compatibility issues. Try enabling Embedded PKCS1 Support in settings.'));
  }

  /**
   * Stop the current livestream
   */
  public stopLocalLiveStream(): void {
    if (!this.stationStream) {
      return;
    }
    
    this.log.debug('Stopping station livestream.');
    this.eufyClient.stopStationLivestream(this.serialNumber);
    this.cleanupStream();
  }

  /**
   * Clean up stream resources
   */
  private cleanupStream(): void {
    if (this.stationStream) {
      // Close and destroy streams
      this.stationStream.audiostream.unpipe();
      this.stationStream.audiostream.destroy();
      this.stationStream.videostream.unpipe();
      this.stationStream.videostream.destroy();
    }
    
    this.stationStream = null;
    this.livestreamStartedAt = null;
  }

  /**
   * Handle station livestream stop event
   */
  private onStationLivestreamStop(station: Station, device: Device): void {
    if (device.getSerial() !== this.serialNumber) {
      return;
    }
    
    this.log.debug(`${station.getName()} station livestream for ${device.getName()} has stopped.`);
    this.cleanupStream();
  }

  /**
   * Handle station livestream start event
   */
  private onStationLivestreamStart(
    station: Station,
    device: Device,
    metadata: StreamMetadata,
    videostream: Readable,
    audiostream: Readable,
  ): void {
    if (device.getSerial() !== this.serialNumber) {
      return;
    }
    
    // Check for duplicate stream start events from station
    if (this.stationStream) {
      const diff = (Date.now() - this.stationStream.createdAt) / 1000;
      if (diff < this.MIN_STREAM_REUSE_SECONDS) {
        this.log.warn('Duplicate livestream start detected from station - ignoring.');
        return;
      }
    }
    
    // Clean up any existing stream
    this.cleanupStream();

    // Set up new stream
    this.log.debug(`${station.getName()} station livestream (P2P session) for ${device.getName()} has started.`);
    this.livestreamStartedAt = Date.now();
    this.stationStream = { 
      station, 
      device, 
      metadata, 
      videostream, 
      audiostream, 
      createdAt: Date.now() 
    };
    
    this.log.debug('Stream metadata: ', this.stationStream.metadata);
    this.emit('livestream start');
  }
}