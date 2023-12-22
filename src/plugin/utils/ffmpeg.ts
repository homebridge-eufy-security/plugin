import { ChildProcess, spawn } from 'child_process';
import os from 'os';
import { Readable, Writable } from 'stream';

import ffmpegPath from 'ffmpeg-for-homebridge';

import { Logger as TsLogger, ILogObj } from 'tslog';
import EventEmitter from 'events';
import { FFmpegProgress } from './ffmpeg-progress';
import { FFmpegParameters } from './ffmpeg-params';

export class FFmpeg extends EventEmitter {

  public process?: ChildProcess;

  protected progress?: FFmpegProgress;

  protected commandLineArgs: string[] = [];

  protected ffmpegExec = ffmpegPath || 'ffmpeg';

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

  protected starttime?: number;
  protected killTimeout?: NodeJS.Timeout;
  public isEnded: boolean = false;

  constructor(
    protected name: string,
    protected parameters: FFmpegParameters[],
    protected log: TsLogger<ILogObj>,
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

    this.commandLineArgs = FFmpegParameters.getCombinedArguments(this.parameters);

    this.log.debug(this.name, 'Stream command: ' + this.ffmpegExec + ' ' + this.commandLineArgs.join(' '));
    this.parameters.forEach((p) => {
      this.log.info(this.name, p.getStreamStartText());
    });

    this.process = spawn(
      this.ffmpegExec,
      this.commandLineArgs.join(' ').split(/\s+/),
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

    this.stdio = this.process.stdio;

    this.process.stderr?.on('data', (chunk) => {
      if (this.parameters[0].debug) {
        this.log.debug(this.name, 'ffmpeg log message:\n' + chunk.toString());
      }
    });

    this.process.on('error', this.onProcessError.bind(this));
    this.process.once('exit', this.onProcessExit.bind(this));
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
      this.process.once('exit', () => {
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

  public stop(): void {
    this.isEnded = true;

    if(!this.commandLineArgs.includes('pipe:')) {
      this.process?.stdin?.end('q');
    }

    this.process?.stdin?.destroy();
    this.process?.stdout?.destroy();

    this.killTimeout = setTimeout(() => {
      this.process?.kill('SIGKILL');
    }, 5 * 1000);

    // Send the kill shot.
    this.process?.kill();
  }

  protected onProgressStarted() {
    this.emit('started');
    const runtime = this.starttime ? (Date.now() - this.starttime) / 1000 : undefined;
    this.log.debug(this.name, `process started. Getting the first response took ${runtime} seconds.`);
  }

  protected onProcessError(error: Error) {
    this.emit('error', error);
  }

  protected onProcessExit(code: number, signal: NodeJS.Signals) {
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

  // Return the standard input for this process.
  public get stdin(): Writable | null {
    return this.process?.stdin ?? null;
  }

  // Return the standard output for this process.
  public get stdout(): Readable | null {
    return this.process?.stdout ?? null;
  }

  // Return the standard error for this process.
  public get stderr(): Readable | null {
    return this.process?.stderr ?? null;
  }
}