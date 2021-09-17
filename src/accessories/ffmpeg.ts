import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { StreamRequestCallback } from 'homebridge';
import os from 'os';
import readline from 'readline';
import { Writable } from 'stream';
import { Logger } from './logger';
import { StreamingDelegate } from './streamingDelegate';


type FfmpegProgress_video = {
  frame: number;
  fps: number;
  stream_q: number;
  bitrate: number;
  total_size: number;
  out_time_us: number;
  out_time: string;
  dup_frames: number;
  drop_frames: number;
  speed: number;
  progress: string;
};

type FfmpegProgress_audio = {
  bitrate: number;
  total_size: number;
  out_time_us: number;
  out_time_ms: number;
  out_time: string;
  dup_frames: number;
  drop_frames: number;
  speed: number;
  progress: string;
};

export class FfmpegProcess {
  private readonly process: ChildProcessWithoutNullStreams;
  private killTimeout?: NodeJS.Timeout;
  readonly stdin: Writable;

  public log;
  private cameraName: string;

  constructor(cameraName: string, sessionId: string, videoProcessor: string, ffmpegArgs: string[], log,
    debug = false, delegate: StreamingDelegate, callback?: StreamRequestCallback) {

    this.log = log;
    this.cameraName = cameraName;

    this.log.debug(this.cameraName, 'Stream command: ' + videoProcessor + ' ' + ffmpegArgs.join(' '));

    let started = false;
    const startTime = Date.now();
    this.process = spawn(videoProcessor, ffmpegArgs.join(' ').split(/\s+/), { env: process.env });
    this.stdin = this.process.stdin;

    this.process.stdout.on('data', (data) => {
      const progress = this.parseProgress(data);
      if (progress) {
        if (!started && progress.bitrate > 0) {
          started = true;
          const runtime = (Date.now() - startTime) / 1000;
          const message = 'Getting the first frames took ' + runtime + ' seconds.';
          if (runtime < 5) {
            this.log.debug(this.cameraName, message);
          } else if (runtime < 22) {
            this.log.warn(this.cameraName, message);
          } else {
            this.log.error(this.cameraName, message);
          }
        }
      }
    });
    const stderr = readline.createInterface({
      input: this.process.stderr,
      terminal: false
    });
    stderr.on('line', (line: string) => {
      if (callback) {
        callback();
        callback = undefined;
      }
      if (debug && line.match(/\[(panic|fatal|error)\]/)) { // For now only write anything out when debug is set
        this.log.error(this.cameraName, line);
      } else if (debug) {
        this.log.debug(this.cameraName, line);
      }
    });
    this.process.on('error', (error: Error) => {
      this.log.error(this.cameraName, 'FFmpeg process creation failed: ' + error.message);
      if (callback) {
        callback(new Error('FFmpeg process creation failed'));
      }
      delegate.stopStream(sessionId);
    });
    this.process.on('exit', (code: number, signal: NodeJS.Signals) => {
      if (this.killTimeout) {
        clearTimeout(this.killTimeout);
      }

      const message = 'FFmpeg exited with code: ' + code + ' and signal: ' + signal;

      if (this.killTimeout && code === 0) {
        this.log.debug(this.cameraName, message + ' (Expected)');
      } else if (code == null || code === 255) {
        if (this.process.killed) {
          this.log.debug(this.cameraName, message + ' (Forced)');
        } else {
          this.log.error(this.cameraName, message + ' (Unexpected)');
        }
      } else {
        this.log.error(this.cameraName, message + ' (Error)');
        delegate.stopStream(sessionId);
        if (!started && callback) {
          callback(new Error(message));
        } else {
          delegate.controller.forceStopStreamingSession(sessionId);
        }
      }
    });
  }

  parseProgress(data: Uint8Array): FfmpegProgress_video | FfmpegProgress_audio | undefined {
    const input = data.toString();

    if (input.indexOf('frame=') == 0) {

      try {
        const progress = new Map<string, string>();
        input.split(/\r?\n/).forEach((line) => {
          const split = line.split('=', 2);
          progress.set(split[0], split[1]);
        });

        return {
          frame: parseInt(progress.get('frame')!),
          fps: parseFloat(progress.get('fps')!),
          stream_q: parseFloat(progress.get('stream_0_0_q')!),
          bitrate: parseFloat(progress.get('bitrate')!),
          total_size: parseInt(progress.get('total_size')!),
          out_time_us: parseInt(progress.get('out_time_us')!),
          out_time: progress.get('out_time')!.trim(),
          dup_frames: parseInt(progress.get('dup_frames')!),
          drop_frames: parseInt(progress.get('drop_frames')!),
          speed: parseFloat(progress.get('speed')!),
          progress: progress.get('progress')!.trim()
        } as FfmpegProgress_video;
      } catch {
        return undefined;
      }

    } else if (input.indexOf('bitrate=') == 0) {

      try {
        const progress = new Map<string, string>();
        input.split(/\r?\n/).forEach((line) => {
          const split = line.split('=', 2);
          progress.set(split[0], split[1]);
        });

        return {
          bitrate: parseFloat(progress.get('bitrate')!),
          total_size: parseInt(progress.get('total_size')!),
          out_time_us: parseInt(progress.get('out_time_us')!),
          out_time_ms: parseInt(progress.get('out_time_ms')!),
          out_time: progress.get('out_time')!.trim(),
          dup_frames: parseInt(progress.get('dup_frames')!),
          drop_frames: parseInt(progress.get('drop_frames')!),
          speed: parseFloat(progress.get('speed')!),
          progress: progress.get('progress')!.trim()
        } as FfmpegProgress_audio;
      } catch {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  public stop(): void {
    this.process.stdin.write('q' + os.EOL);
    this.killTimeout = setTimeout(() => {
      this.process.kill('SIGKILL');
    }, 2 * 1000);
  }
}
