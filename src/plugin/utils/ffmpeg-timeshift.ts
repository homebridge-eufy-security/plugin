/* eslint-disable max-len */
/* 
 * This module is heavily inspired by the homebridge, homebridge-camera-ffmpeg and homebridge-unifi-protect source code. Thank you for your contributions to the HomeKit world.
 */
import { EventEmitter } from 'node:events';
import { Camera, PlatformAccessory } from 'homebridge';
import { Logger as TsLogger, ILogObj } from 'tslog';

import { PROTECT_HKSV_SEGMENT_RESOLUTION } from '../settings.js';
import { CameraAccessory } from '../accessories/CameraAccessory.js';
import { EufySecurityPlatform } from '../platform.js';
import { LocalLivestreamManager } from '../controller/LocalLivestreamManager.js';

// UniFi Protect livestream timeshift buffer.
export class ProtectTimeshiftBuffer extends EventEmitter {

  private readonly platform: EufySecurityPlatform = this.camera.platform;
  private readonly accessory: PlatformAccessory = this.camera.accessory;
  private readonly device: Camera = this.camera.device;
  private readonly log: TsLogger<ILogObj> = this.platform.ffmpegLogger;

  private buffer: Buffer[];
  private bufferSize: number;
  private channelId: number;
  private readonly livestream: LocalLivestreamManager;
  private _isStarted: boolean;
  private _isTransmitting: boolean;
  private _segmentLength: number;

  constructor(private readonly camera: CameraAccessory) {

    // Initialize the event emitter.
    super();

    this.buffer = [];
    this.bufferSize = 1;
    this.channelId = 0;
    this._isStarted = false;
    this.livestream = new LocalLivestreamManager(camera);

    // We use a small value for segment resolution in our timeshift buffer to ensure we provide an optimal timeshifting experience.
    // It's a very small amount of additional overhead for most modern CPUs, but the result is a much better HKSV event recording.
    this._segmentLength = PROTECT_HKSV_SEGMENT_RESOLUTION;

    this._isTransmitting = false;
    this.configureTimeshiftBuffer();
  }

  // Configure the timeshift buffer.
  private configureTimeshiftBuffer(): void {

    let seenInitSegment = false;

    // If the livestream API has closed, stop what we're doing.
    this.livestream.on('close', () => {

      this.log.error('The livestream API connection was unexpectedly closed by the Device. ' +
        'This is typically due to device restarts or issues with Device firmware versions, and can be safely ignored. Will retry again shortly.');
      this.stop();
    });

    // First, we need to listen for any segments sent by the UniFi Protect livestream in order to create our timeshift buffer.
    this.livestream.on('message', (segment: Buffer) => {

      // Crucially, we don't want to keep any initialization segment (which is always composed of FTYP and MOOV boxes) in our timeshift buffer. The reason for this is
      // that these boxes are special in the fMP4 world and must be transmitted at the beginning of any new fMP4 stream. So what do we do? The livestream saves the
      // initialization segment for us, so all we need to do is ensure we don't include them in our timeshift buffer. There should only ever be a single initialization
      //segment, so once we've seen one, we don't need to worry about it again.
      if (!seenInitSegment && this.livestream.initSegment?.equals(segment)) {

        seenInitSegment = true;
        return;
      }

      // Add the livestream segment to the end of the timeshift buffer.
      this.buffer.push(segment);

      // At a minimum we always want to maintain a single segment buffer.
      if (this.bufferSize <= 0) {

        this.bufferSize = 1;
      }

      // Trim the beginning of the buffer to our configured size unless we are transmitting
      // to HomeKit, in which case, we queue up all the segments for consumption.
      if (!this.isTransmitting && (this.buffer.length > this.bufferSize)) {

        this.buffer.shift();
      }

      // If we're transmitting, we want to send all the segments we can so FFmpeg can consume it.
      if (this.isTransmitting) {

        for (let segment = this.buffer.shift(); segment; segment = this.buffer.shift()) {

          this.emit('segment', segment);
        }
      }
    });
  }

  // Start the livestream and begin maintaining our timeshift buffer.
  public async start(channelId: number, lens = 0): Promise<boolean> {

    // Stop the timeshift buffer if it's already running.
    this.stop();

    // Clear out the timeshift buffer, if it's been previously filled, and then fire up the timeshift buffer.
    this.buffer = [];

    // Start the livestream and start buffering.
    if (!(await this.livestream.getLocalLivestream())) {

      // Something went wrong in communicating with the controller.
      return false;
    }

    this.channelId = channelId;
    this._isStarted = true;

    return true;
  }

  // Stop timeshifting the livestream.
  public stop(): boolean {

    this.livestream.stopLocalLiveStream();
    this.buffer = [];
    this._isStarted = false;

    return true;
  }

  // Start transmitting our timeshift buffer.
  public async startTransmitting(): Promise<boolean> {

    // If we haven't started the livestream, or it was closed for some reason, let's start it now.
    if (!this.isStarted && !(await this.start(this.channelId))) {

      this.log.error('Unable to access the Protect livestream API. ' +
        'This is typically due to the Device or camera rebooting. Will retry again on the next detected motion event.');

      this.livestream.stopLocalLiveStream();

      return false;
    }

    // Add the initialization segment to the beginning of the timeshift buffer, if we have it.
    // If we don't, FFmpeg will still be able to generate a valid fMP4 stream, albeit a slightly less elegantly.
    const initSegment = await this.getInitSegment();

    if (initSegment) {

      this.buffer.unshift(initSegment);
    } else {

      this.log.error('Unable to begin transmitting the stream to HomeKit Secure Video. ' +
        'Cannot retrieve initialization data from the UniFi Device. ' +
        'This error is typically due to either an issue connecting to the Device, or a problem on the Device.');

      this.livestream.stopLocalLiveStream();

      return false;
    }

    // Signal our livestream listener that it's time to start transmitting our queued segments and timeshift.
    this._isTransmitting = true;
    return true;
  }

  // Stop transmitting our timeshift buffer.
  public stopTransmitting(): boolean {

    // We're done transmitting, flag it, and allow our buffer to resume maintaining itself.
    this._isTransmitting = false;
    return true;
  }

  // Check if this is the fMP4 initialization segment.
  public isInitSegment(segment: Buffer): boolean {

    if (this.livestream.initSegment?.equals(segment)) {

      return true;
    }

    return false;
  }

  // Get the fMP4 initialization segment from the livestream API.
  public async getInitSegment(): Promise<Buffer | null> {

    // If we have the initialization segment, return it.
    if (this.livestream.initSegment) {
      return Promise.resolve(this.livestream.initSegment);
    }

    // We haven't seen it yet, wait for a couple of seconds and check an additional time.
    await new Promise(resolve => setTimeout(resolve, 2000));

    // We either have it or we don't - we can't afford to wait too long for this - HKSV is time-sensitive and we need to ensure we have a reasonable
    // upper bound on how long we wait for data from the Protect API.
    return Promise.resolve(this.livestream.initSegment);
  }

  // Return whether or not we have started the timeshift buffer.
  public get isStarted(): boolean {
    return this._isStarted;
  }

  // Return whether we are transmitting our timeshift buffer or not.
  public get isTransmitting(): boolean {
    return this._isTransmitting;
  }

  // Retrieve the current size of the timeshift buffer, in milliseconds.
  public get length(): number {
    return (this.bufferSize * this.segmentLength);
  }

  // Set the size of the timeshift buffer, in milliseconds.
  public set length(bufferMillis: number) {
    // Calculate how many segments we need to keep in order to have the appropriate number of seconds in
    // our buffer.
    this.bufferSize = bufferMillis / this.segmentLength;
  }

  // Return the recording length, in milliseconds, of an individual segment.
  public get segmentLength(): number {
    return this._segmentLength;
  }
}