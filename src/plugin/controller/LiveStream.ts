/* eslint-disable max-len */
import events, { EventEmitter } from 'node:events';
import { Logger as TsLogger, ILogObj } from 'tslog';
import { EufySecurityPlatform } from '../platform';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { Device, EufySecurity, Station, StreamMetadata } from 'eufy-security-client';
import { Readable } from 'node:stream';

export class EufyLivestream extends EventEmitter {

  private _initSegment: Buffer | null;
  private errorHandler: ((error: Error) => void) | null;
  private segmentHandler: ((packet: Buffer) => void) | null;
  private platform: EufySecurityPlatform;
  private readonly log: TsLogger<ILogObj>;
  private readonly eufyClient: EufySecurity;

  // Create a new instance.
  constructor(private camera: CameraAccessory) {

    // Initialize the event emitter.
    super();

    this._initSegment = null;
    this.errorHandler = null;
    this.segmentHandler = null;
    this.platform = camera.platform;
    this.eufyClient = this.platform.eufyClient;
    this.log = camera.platform.log;
  }

  // Start the UniFi Protect livestream.
  public async start(cameraId: string, channel: number, lens = 0, segmentLength = 100, requestId = cameraId + '-' + channel.toString()): Promise<boolean> {

    // Stop any existing stream.
    this.stop();

    // Clear out the initialization segment.
    this._initSegment = null;

    // Launch the livestream.
    return await this.launchLivestream(cameraId, channel, lens, segmentLength, requestId);
  }

  // Stop the UniFi Protect livestream.
  public async stop(): Promise<void> {

    await this.platform.eufyClient.stopStationLivestream(this.camera.SN);

    // Clean up our segment processing handler.
    if (this.errorHandler) {

      this.errorHandler = null;
    }

    if (this.segmentHandler) {

      this.segmentHandler = null;
    }

  }

  // Configure the websocket to populate the prebuffer.
  private async launchLivestream(cameraId: string, channel: number, lens: number, segmentLength: number, requestId: string): Promise<boolean> {
    // To ensure there are minimal performance implications to the Protect NVR, enforce a 100ms floor for
    // segment length. Protect happens to default to a 100ms segment length as well, so we do too.
    if (segmentLength < 100) {
      segmentLength = 100;
    }

    await this.eufyClient.startStationLivestream(this.camera.SN);

    this.platform.eufyClient.on('station livestream start',
      (station: Station, device: Device, metadata: StreamMetadata, videostream: Readable, audiostream: Readable) => {
        this.processLivestream(station, device, metadata, videostream, audiostream);
      });

    return true;
  }

  // Process fMP4 packets as they arrive over the websocket.
  private async processLivestream(station: Station, device: Device, metadata: StreamMetadata, videostream: Readable, audiostream: Readable): Promise<void> {
    this.log.debug(`${this.camera.name} Stream metadata: ' + ${JSON.stringify(metadata)}`);
    
    const currentSegment = {
      audio: Buffer.alloc(0),
      video: Buffer.alloc(0),
    };

    // Create Promises to track when data is available from each stream
    const videoPromise = new Promise<void>((resolve) => {
      videostream.on('data', (data) => {
        // Append video data to the currentSegment.video
        currentSegment.video = Buffer.concat([currentSegment.video, data]);
        resolve();
      });
    });

    const audioPromise = new Promise<void>((resolve) => {
      audiostream.on('data', (data) => {
        // Append audio data to the currentSegment.audio
        currentSegment.audio = Buffer.concat([currentSegment.audio, data]);
        resolve();
      });
    });

    // Wait for both video and audio data to be processed
    await Promise.all([videoPromise, audioPromise]);

    this.emit('message', Buffer.concat([currentSegment.video, currentSegment.audio]));
  }

  // Asynchronously wait for the initialization segment.
  public async getInitSegment(): Promise<Buffer> {

    // Return our segment once we've seen it.
    if (this.initSegment) {

      return this.initSegment;
    }

    // Wait until the initialization segment is seen and then try again.
    await events.once(this, 'initsegment');
    return this.getInitSegment();
  }

  // Retrieve the initialization segment, if we've seen it.
  public get initSegment(): Buffer | null {

    return this._initSegment;
  }
}