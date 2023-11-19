import { ChildProcess, spawn } from 'child_process';
import net from 'net';
import os from 'os';
import { Readable, Writable } from 'stream';

import ffmpegPath from 'ffmpeg-for-homebridge';

import { Logger as TsLogger, ILogObj } from 'tslog';
import EventEmitter from 'events';
import { FFmpegProgress } from './ffmpeg-progress';
import { FFmpegParameters } from './ffmpeg-params';

export class FFmpeg extends EventEmitter {

  private process?: ChildProcess;

  private progress?: FFmpegProgress;

  private ffmpegExec = ffmpegPath || 'ffmpeg';

  public stdin?: Writable | null;
  public stdout?: Readable | null;
  public stdio?: [
    Writable | null,
    // stdin
    Readable | null,
    // stdout
    Readable | null,
    // stderr
    Readable | Writable | null | undefined,
    // extra
    Readable | Writable | null | undefined, // extra
  ];

  private starttime?: number;
  private killTimeout?: NodeJS.Timeout;

  constructor(
    private name: string,
    private parameters: FFmpegParameters[],
    private log: TsLogger<ILogObj>,
  ) {
    super();
    if (parameters.length === 0) {
      throw new Error('No ffmpeg parameters found.');
    }
  }

  public start() {

    this.starttime = Date.now();

    this.progress = new FFmpegProgress(this.parameters[0].progressPort);
    this.progress.on('progress started', this.onProgressStarted.bind(this));

    const processArgs = FFmpegParameters.getCombinedArguments(this.parameters);

    this.log.debug(this.name, 'Stream command: ' + this.ffmpegExec + ' ' + processArgs.join(' '));
    this.parameters.forEach((p) => {
      this.log.info(this.name, p.getStreamStartText());
    });

    this.process = spawn(this.ffmpegExec, processArgs.join(' ').split(/\s+/),
      {
        env: process.env,
        stdio: [
          /* Standard: stdin, stdout, stderr */
          'inherit', 'inherit', 'inherit',
          /* Custom: pipe:3, pipe:4 */
          'pipe', 'pipe',
        ],
      });

    this.stdin = this.process.stdin;
    this.stdout = this.process.stdout;
    this.stdio = this.process.stdio;

    this.process.stderr?.on('data', (chunk) => {
      if (this.parameters[0].debug) {
        this.log.debug(this.name, 'ffmpeg log message:\n' + chunk.toString());
      }
    });

    this.process.on('error', this.onProcessError.bind(this));
    this.process.on('exit', this.onProcessExit.bind(this));
  }

  public async getResult(input?: Buffer): Promise<Buffer> {
    this.starttime = Date.now();

    this.progress = new FFmpegProgress(this.parameters[0].progressPort);
    this.progress.on('progress started', this.onProgressStarted.bind(this));

    const processArgs = FFmpegParameters.getCombinedArguments(this.parameters);
    this.log.debug(this.name, 'Process command: ' + this.ffmpegExec + ' ' + processArgs.join(' '));

    return new Promise((resolve, reject) => {
      this.process = spawn(this.ffmpegExec, processArgs.join(' ').split(/\s+/), { env: process.env });

      this.process.stderr?.on('data', (chunk) => {
        if (this.parameters[0].debug) {
          this.log.debug(this.name, 'ffmpeg log message:\n' + chunk.toString());
        }
      });

      const killTimeout = setTimeout(() => {
        this.stop();
        reject('ffmpeg process timed out.');
      }, 15 * 1000);

      this.process.on('error', (err) => {
        reject(err);
        this.onProcessError(err);
      });

      let resultBuffer = Buffer.alloc(0);
      this.process.stdout?.on('data', (data) => {
        resultBuffer = Buffer.concat([resultBuffer, data]);
      });
      this.process.on('exit', () => {
        if (killTimeout) {
          clearTimeout(killTimeout);
        }

        if (resultBuffer.length > 0) {
          resolve(resultBuffer);
        } else {
          reject('Failed to fetch data.');
        }
      });
      if (input) {
        this.process.stdin?.end(input);
      }
    });
  }

  public async startFragmentedMP4Session(): Promise<{
    socket: net.Socket;
    process?: ChildProcess;
    generator: AsyncGenerator<{
      header: Buffer;
      length: number;
      type: string;
      data: Buffer;
    }>;
  }> {
    this.starttime = Date.now();

    this.progress = new FFmpegProgress(this.parameters[0].progressPort);
    this.progress.on('progress started', this.onProgressStarted.bind(this));

    const port = await FFmpegParameters.allocateTCPPort();

    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        server.close();

        resolve({
          socket: socket,
          process: this.process,
          generator: this.parseFragmentedMP4(socket),
        });
      });

      server.listen(port, () => {
        this.parameters[0].setOutput(`tcp://127.0.0.1:${port}`);
        const processArgs = FFmpegParameters.getRecordingArguments(this.parameters);

        this.log.debug(this.name, 'Stream command: ' + this.ffmpegExec + ' ' + processArgs.join(' '));
        this.parameters.forEach((p) => {
          this.log.info(this.name, p.getStreamStartText());
        });

        this.process = spawn(this.ffmpegExec, processArgs.join(' ').split(/\s+/), { env: process.env });
        this.stdin = this.process.stdin;
        this.stdout = this.process.stdout;
        this.stdio = this.process.stdio;

        if (this.parameters[0].debug) {
          this.process.stderr?.on('data', (chunk) => {
            this.log.debug(this.name, 'ffmpeg log message:\n' + chunk.toString());
          });
        }

        this.process.on('error', this.onProcessError.bind(this));
        this.process.on('exit', this.onProcessExit.bind(this));
      });
    });
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

  public stop(): void {
    let usesStdIn = false;
    this.parameters.forEach(p => {
      if (p.usesStdInAsInput()) {
        usesStdIn = true;
      }
    });

    if (usesStdIn) {
      this.process?.stdin?.destroy();
      this.process?.kill('SIGTERM');
    } else {
      this.process?.stdin?.write('q' + os.EOL);
    }

    this.killTimeout = setTimeout(() => {
      this.process?.kill('SIGKILL');
    }, 2 * 1000);
  }

  private onProgressStarted() {
    this.emit('started');
    const runtime = this.starttime ? (Date.now() - this.starttime) / 1000 : undefined;
    this.log.debug(this.name, `process started. Getting the first response took ${runtime} seconds.`);
  }

  private onProcessError(error: Error) {
    this.emit('error', error);
  }

  private onProcessExit(code: number, signal: NodeJS.Signals) {
    this.emit('exit');

    if (this.killTimeout) {
      clearTimeout(this.killTimeout);
    }

    const message = 'FFmpeg exited with code: ' + code + ' and signal: ' + signal;
    if (this.killTimeout && code === 0) {
      this.log.info(this.name, message + ' (Expected)');
    } else if (code === null || code === 255) {
      if (this.process?.killed) {
        this.log.info(this.name, message + ' (Forced)');
      } else {
        this.log.error(this.name, message + ' (Unexpected)');
      }
    } else {
      this.emit('error', message + ' (Error)');
      this.log.error(this.name, message + ' (Error)');
    }
  }
}