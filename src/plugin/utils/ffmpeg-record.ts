import { ChildProcess, spawn } from 'child_process';
import net from 'net';

import { Logger as TsLogger, ILogObj } from 'tslog';
import { FFmpegProgress } from './ffmpeg-progress';
import { FFmpegParameters } from './ffmpeg-params';
import { FFmpeg } from './ffmpeg';
import { once } from 'node:events';

export class FFmpegRecord extends FFmpeg {

  private recordingBuffer: {
    data: Buffer;
    header: Buffer;
    length: number;
    type: string;
  }[] = [];

  constructor(
    name: string,
    parameters: FFmpegParameters[],
    log: TsLogger<ILogObj>,
  ) {
    super(name, parameters, log);
  }

  public override start() {

    this.starttime = Date.now();

    this.progress = new FFmpegProgress(this.parameters[0].progressPort);
    this.progress.on('progress started', this.onProgressStarted.bind(this));

    const processArgs = FFmpegParameters.getRecordingArguments(this.parameters);

    this.log.debug(this.name, 'Stream command: ' + this.ffmpegExec + ' ' + processArgs.join(' '));
    this.parameters.forEach((p) => {
      this.log.info(this.name, p.getStreamStartText());
    });

    this.process = spawn(
      this.ffmpegExec,
      processArgs.join(' ').split(/\s+/),
      {
        env: process.env,
        stdio: [
          /* Standard: stdin, stdout, stderr */
          'inherit', 'inherit', 'inherit',
          /* Custom: pipe:3, pipe:4 */
          'pipe', 'pipe',
        ],
      },
    );

    this.stdin = this.process.stdin;
    this.stdout = this.process.stdout;
    this.stdio = this.process.stdio;

    this.process.stderr?.on('data', (chunk) => {
      if (this.parameters[0].debug) {
        this.log.debug(this.name, 'ffmpeg log message:\n' + chunk.toString());
      }
    });

    let dataListener: (buffer: Buffer) => void;
    let header = Buffer.alloc(0);
    let bufferRemaining = Buffer.alloc(0);
    let dataLength = 0;
    let type = '';

    this.process.stdout?.on('data', dataListener = (buffer: Buffer): void => {

      // If we have anything left from the last buffer we processed, prepend it to this buffer.
      if (bufferRemaining.length > 0) {

        buffer = Buffer.concat([bufferRemaining, buffer]);
        bufferRemaining = Buffer.alloc(0);
      }

      let offset = 0;

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
        if (!header.length) {

          // Grab the header. The first four bytes represents the length of the entire box. Second four bytes represent the box type.
          header = buffer.slice(0, 8);

          // Now we retrieve the length of the box and subtract the length of the header to get the length of the data portion of the box.
          dataLength = header.readUInt32BE(0) - 8;

          // Get the type of the box. This is always a string and has a funky history to it that makes for an interesting read!
          type = header.slice(4).toString();

          // Finally, we get the data portion of the box.
          data = buffer.slice(8, dataLength + 8);
          offset = 8;
        } else {

          // Grab the data from our buffer.
          data = buffer.slice(0, dataLength);
          offset = 0;
        }

        // If we don't have enough data in this buffer, save what we have for the next buffer we see and append it there.
        if (data.length < dataLength) {

          bufferRemaining = data;
          break;
        }

        // Add it to our queue to be eventually pushed out through our generator function.
        this.recordingBuffer.push({ data: data, header: header, length: dataLength, type: type });
        this.emit('mp4box');

        // Prepare to start a new box for the next buffer that we will be processing.
        data = Buffer.alloc(0);
        header = Buffer.alloc(0);
        type = '';

        // We've parsed an entire box, and there's no more data in this buffer to parse.
        if (buffer.length === (offset + dataLength)) {

          dataLength = 0;
          break;
        }

        // If there's anything left in the buffer, move us to the new box and let's keep iterating.
        buffer = buffer.slice(offset + dataLength);
        dataLength = 0;
      }
    });

    this.process.on('error', this.onProcessError.bind(this));

    this.process.on('exit', () => {
      this.process?.stdout?.removeListener('data', dataListener);
      this.onProcessExit.bind(this);
      this.emit('mp4box');
    });
  }

  public async *segmentGenerator(): AsyncGenerator<Buffer> {
    let segment: Buffer[] = [];

    for (; ;) {

      if (this.isEnded) {
        return;
      }

      if (!this.recordingBuffer.length) {

        // eslint-disable-next-line no-await-in-loop
        await once(this, 'mp4box');
      }

      const box = this.recordingBuffer.shift();

      if (!box) {
        continue;
      }

      segment.push(box.header, box.data);

      if ((box.type === 'moov') || (box.type === 'mdat')) {
        yield Buffer.concat(segment);
        segment = [];
      }

    }

  }

  private async * parseFragmentedMP4(socket: net.Socket) {
    while (true) {
      const header = await this.readLength(socket, 8);
      const length = header.readInt32BE(0) - 8;
      const type = header.slice(4).toString();
      const data = await this.readLength(socket, length);

      yield {
        header,
        length,
        type,
        data,
      };
    }
  }

  private async readLength(socket: net.Socket, length: number): Promise<Buffer> {
    if (length <= 0) {
      return Buffer.alloc(0);
    }

    const value = socket.read(length);
    if (value) {
      return value;
    }

    return new Promise((resolve, reject) => {
      const readHandler = () => {
        const value = socket.read(length);

        if (value) {
          cleanup();
          resolve(value);
        }
      };

      const endHandler = () => {
        cleanup();
        reject(new Error(`FFMPEG socket closed during read for ${length} bytes!`));
      };

      const cleanup = () => {
        socket.removeListener('readable', readHandler);
        socket.removeListener('close', endHandler);
      };

      if (!socket) {
        throw new Error('FFMPEG socket is closed now!');
      }

      socket.on('readable', readHandler);
      socket.on('close', endHandler);
    });
  }
}