import { spawn } from 'child_process';

import { FFmpegProgress } from './ffmpeg-progress';
import { FFmpegParameters } from './ffmpeg-params';
import { FFmpeg } from './ffmpeg';
import { once } from 'node:events';
import { ffmpegLogger } from './utils';

export class FFmpegRecord extends FFmpeg {

  private recordingBuffer: {
    data: Buffer;
    header: Buffer;
    length: number;
    type: string;
  }[] = [];

  private bufferRemaining: Buffer = Buffer.alloc(0);
  private currentHeader: Buffer = Buffer.alloc(0);
  private currentType: string = '';
  private currentDataLength: number = 0;

  constructor(
    name: string,
    parameters: FFmpegParameters[],
  ) {
    super(name, parameters);
  }

  public override start() {

    this.starttime = Date.now();

    this.progress = new FFmpegProgress(this.parameters[0].progressPort);
    this.progress.on('progress started', this.onProgressStarted.bind(this));

    const processArgs = FFmpegParameters.getRecordingArguments(this.parameters);

    ffmpegLogger.debug(`${this.name} Stream command: ${this.ffmpegExec} ${processArgs.join(' ')}`);

    this.process = spawn(
      this.ffmpegExec,
      processArgs.join(' ').split(/\s+/),
      {
        env: process.env,
        stdio: ['inherit', 'pipe', 'inherit', 'pipe', 'pipe'],
      },
    );

    // Set up the stderr, stdout and exit handlers
    this.setupStderrHandler();
    this.setupStdoutHandler();
    this.setupExitHandler();
  }

  private setupStderrHandler() {
    this.stderr?.on('data', (chunk) => {
      if (this.parameters[0].debug) {
        ffmpegLogger.debug(`${this.name} ffmpeg log message:\n ${chunk.toString()}`);
      }
    });
  }

  private setupStdoutHandler() {
    if (this.stdout) {
      this.stdout.on('data', (data) => {
        this.handleFFmpegOutput(data);
      });
    }
  }

  private setupExitHandler() {
    this.process?.on('exit', () => {
      this.cleanupOnExit();
    });
  }

  private cleanupOnExit() {
    ffmpegLogger.debug(`${this.name} cleanupOnExit`);
    this.emit('mp4box');
    this.isEnded = true;

    // Remove listeners
    this.process?.stderr?.removeAllListeners('data');
    this.process?.stdout?.removeAllListeners('data');
  }

  private handleFFmpegOutput(buffer: Buffer): void {
    // Initialize our variables that we need to process incoming FFmpeg packets.

    let offset = 0;

    // If we have anything left from the last buffer we processed, prepend it to this buffer.
    if (this.bufferRemaining.length > 0) {
      buffer = Buffer.concat([this.bufferRemaining, buffer]);
      this.bufferRemaining = Buffer.alloc(0);
    }

    // FFmpeg is outputting an fMP4 stream that's suitable for HomeKit Secure Video. However, we can't just
    // pass this stream directly back to HomeKit since we're using a generator-based API to send packets back to
    // HKSV. Here, we take on the task of parsing the fMP4 stream that's being generated and split it up into the
    // MP4 boxes that HAP-NodeJS is ultimately expecting.
    for (; ;) {

      let data;

      // The MP4 container format is well-documented and designed around the concept of boxes. A box (or atom as they
      // used to be called), is at the center of an MP4 container. It's composed of an 8-byte header, followed by the data payload
      // it carries.

      // No existing header, let's start a new box.
      if (!this.currentHeader.length) {

        // Grab the header. The first four bytes represents the length of the entire box. Second four bytes represent the box type.
        this.currentHeader = buffer.slice(0, 8);

        // Now we retrieve the length of the box and subtract the length of the header to get the length of the data portion of the box.
        this.currentDataLength = this.currentHeader.readUInt32BE(0) - 8;

        // Get the type of the box. This is always a string and has a funky history to it that makes for an interesting read!
        this.currentType = this.currentHeader.slice(4).toString();

        // Finally, we get the data portion of the box.
        data = buffer.slice(8, this.currentDataLength + 8);
        offset = 8;
      } else {

        // Grab the data from our buffer.
        data = buffer.slice(0, this.currentDataLength);
        offset = 0;
      }

      // If we don't have enough data in this buffer, save what we have for the next buffer we see and append it there.
      if (data.length < this.currentDataLength) {

        this.bufferRemaining = data;
        break;
      }

      // Add it to our queue to be eventually pushed out through our generator function.
      this.recordingBuffer.push({ data: data, header: this.currentHeader, length: this.currentDataLength, type: this.currentType });
      this.emit('mp4box');

      // Prepare to start a new box for the next buffer that we will be processing.
      data = Buffer.alloc(0);
      this.currentHeader = Buffer.alloc(0);
      this.currentType = '';

      // We've parsed an entire box, and there's no more data in this buffer to parse.
      if (buffer.length === (offset + this.currentDataLength)) {

        this.currentDataLength = 0;
        break;
      }

      // If there's anything left in the buffer, move us to the new box and let's keep iterating.
      buffer = buffer.slice(offset + this.currentDataLength);
      this.currentDataLength = 0;
    }
  }

  public async *segmentGenerator(): AsyncGenerator<Buffer> {
    let segment: Buffer[] = [];

    for (; ;) {

      // FFmpeg has finished it's output - we're done.
      if (this.isEnded) {
        return;
      }

      // If the buffer is empty, wait for our FFmpeg process to produce more boxes.
      if (!this.recordingBuffer.length) {

        // eslint-disable-next-line no-await-in-loop
        await once(this, 'mp4box');
      }

      // Grab the next fMP4 box from our buffer.
      const box = this.recordingBuffer.shift();

      // No fMP4 box, let's keep trying.
      if (!box) {
        continue;
      }

      ffmpegLogger.debug(`${this.name} Yeah a Segment!`);
      segment.push(box.header, box.data);

      // What we want to send are two types of complete segments, made up of multiple MP4 boxes:
      //
      // - a complete MOOV box, usually with an accompanying FTYP box, that's sent at the very
      //   beginning of any valid fMP4 stream. HomeKit Secure Video looks for this before anything
      //   else.
      //
      // - a complete MOOF/MDAT pair. MOOF describes the sample locations and their sizes and MDAT contains the actual audio and video
      //   data related to that segment. This of MOOF as the audio/video data "header", and MDAT as the "payload".
      //
      // Once we see these, we combine all the segments in our queue to send back to HomeKit.
      if ((box.type === 'moov') || (box.type === 'mdat')) {
        yield Buffer.concat(segment);
        segment = [];
      }

    }

  }
}