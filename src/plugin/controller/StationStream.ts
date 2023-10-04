import { Readable, PassThrough } from 'stream';
import { EufySecurityPlatform } from '../platform';
import { Device, EufySecurity, Station, StreamMetadata } from 'eufy-security-client';
import { randomBytes } from 'crypto';
import { Logger as TsLogger, ILogObj } from 'tslog';

/**
 * StationStream handles live video and audio streams for a security station.
 */
export class StationStream {
  private isLivestreaming = false;
  private noiseInterval: NodeJS.Timeout | null = null;
  private streamMetadata?: StreamMetadata;

  private videoStream?: Readable;
  private audioStream?: Readable;

  private readonly log: TsLogger<ILogObj> = this.platform.log;
  private readonly eufyClient: EufySecurity = this.platform.eufyClient;
  private readonly name: string = this.camera.getName();
  private readonly serial: string = this.camera.getSerial();

  /**
   * Constructor: Initialize the StationStream.
   * @param {EufySecurityPlatform} platform - The security platform
   * @param {Device} camera - The camera device
   */
  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly camera: Device,
  ) {
    this.eufyClient.once('station livestream start', this.onLiveStreamStarted);
    this.eufyClient.once('station livestream stop', this.onLiveStreamStopped);
  }

  /**
   * Called when a live stream is started from the station.
   * @param {Station} station - The station initiating the live stream
   * @param {Device} device - The device used in the live stream
   * @param {StreamMetadata} metadata - Metadata about the stream
   * @param {Readable} videostream - The video stream
   * @param {Readable} audiostream - The audio stream
   */
  private onLiveStreamStarted = (
    station: Station,
    device: Device,
    metadata: StreamMetadata,
    videostream: Readable,
    audiostream: Readable,
  ): void => {
    if (device.getSerial() === this.serial) {
      this.log.debug(`${this.name}, live stream started from station ${station.getName()}`);
      this.streamMetadata = metadata;
      this.videoStream = videostream;
      this.audioStream = audiostream;
    } else {
      this.log.error(`${this.name}, mixing stream ${station.getName()} with ${device.getSerial()} for ${this.serial}`);
    }
  };

  /**
   * Called when a live stream is stopped from the station.
   * @param {Station} station - The station stopping the live stream
   * @param {Device} device - The device used in the live stream
   */
  private onLiveStreamStopped = (station: Station, device: Device): void => {
    if (device.getSerial() === this.serial) {
      this.log.debug(`${this.name}, live stream stopped from station ${station.getName()}`);
      this.videoStream = undefined;
      this.audioStream = undefined;
      this.streamMetadata = undefined;
    } else {
      this.log.error(`${this.name}, mixing stream ${station.getName()} with ${device.getSerial()} for ${this.serial}`);
    }
  };

  /**
   * Initialize the live stream.
   */
  public async startLivestream(): Promise<void> {
    if (!this.isLivestreaming) {
      await this.eufyClient.startStationLivestream(this.serial);
      this.isLivestreaming = true;
    }
  }

  /**
   * Terminate the live stream.
   */
  public async stopLivestream(): Promise<void> {
    if (this.isLivestreaming) {
      await this.eufyClient.stopStationLivestream(this.serial);
      this.isLivestreaming = false;
      this.clearAllResources();
    }
  }

  /**
   * Get stream metadata.
   * @returns {StreamMetadata | undefined} The current stream metadata or undefined if not set.
   */
  public getMetadata(): StreamMetadata | undefined {
    return this.streamMetadata;
  }

  /**
   * Create a readable stream that combines video and audio.
   * Fills the gap with random noise if the actual streams are not available or stop due to an error.
   * @returns {Readable} Combined video and audio stream
   */
  public createReadStream(): Readable {
    const combinedStream = new PassThrough();
    let videoAvailable = false;
    let audioAvailable = false;

    const fillNoise = () => {
      if (!videoAvailable) {
        const videoNoise = randomBytes(1000);  // Random noise of 1000 bytes
        combinedStream.write(videoNoise);
      }
      if (!audioAvailable) {
        const audioNoise = randomBytes(100);  // Random noise of 100 bytes
        combinedStream.write(audioNoise);
      }
    };

    this.noiseInterval = setInterval(fillNoise, 100);  // Fill every 100ms

    // Handle video stream
    if (this.videoStream) {
      videoAvailable = true;
      this.videoStream.pipe(combinedStream, {
        end: false,
      });
      this.videoStream.on('end', () => {
        videoAvailable = false;
      });
      this.videoStream.on('error', () => {
        videoAvailable = false;
      });
    }

    // Handle audio stream
    if (this.audioStream) {
      audioAvailable = true;
      this.audioStream.pipe(combinedStream, {
        end: false,
      });
      this.audioStream.on('end', () => {
        audioAvailable = false;
      });
      this.audioStream.on('error', () => {
        audioAvailable = false;
      });
    }

    // Cleanup
    combinedStream.on('end', () => {
      this.clearAllResources();
    });

    return combinedStream;
  }

  /**
  * Clear all resources, including streams and noise generator.
  */
  private clearAllResources(): void {
    if (this.noiseInterval !== null) {
      clearInterval(this.noiseInterval);
      this.noiseInterval = null;
    }
  }
}