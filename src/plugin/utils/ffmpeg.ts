import { ChildProcess, SpawnOptions, spawn } from 'child_process';
import { CameraController, StreamRequestCallback } from 'homebridge';
import { Readable, Writable } from 'stream';
import { StreamingDelegate } from '../controller/streamingDelegate';
import { ffmpegLogger } from './utils';
import { defaultFfmpegPath } from '@homebridge/camera-utils';

export class FfmpegProcess {
    private readonly process: ChildProcess;

    constructor(sessionId: string, ffmpegArgs: string[], stdio: Readable[] | null | undefined,
        debug: boolean, delegate: StreamingDelegate<CameraController>, callback?: StreamRequestCallback) {

        const pathToFfmpeg = defaultFfmpegPath ?? 'ffmpeg';

        ffmpegLogger.debug(`Stream command: ${pathToFfmpeg} ${ffmpegArgs.join(' ')}`);

        let started = false;

        let options: SpawnOptions = { env: process.env, stdio: 'pipe' };

        if (stdio) {
            options.stdio = ['ignore', 'inherit', 'inherit', 'pipe', 'pipe'];
        }

        this.process = spawn(pathToFfmpeg, ffmpegArgs, options);

        if (
            this.process.stdio
            && stdio
            && this.process.stdio.length === 5
            && this.process.stdio[3] instanceof Writable
            && this.process.stdio[4] instanceof Writable
        ) {
            const [videoStream, audioStream] = stdio;

            if (stdio) {
                ffmpegLogger.debug('Pipping stdio to FFmpeg process.');
                videoStream.pipe(this.process.stdio[3]);
                audioStream.pipe(this.process.stdio[4]);
            }
        } else {
            ffmpegLogger.error('FFmpegProcess failed to start stream: input to ffmpeg was provided as stdio, but the process does not support stdio.');
            delegate.stopStream(sessionId);
        }

        if (this.process.stderr) {
            this.process.stderr.on('data', (data) => {
                if (!started) {
                    started = true;
                    if (callback) {
                        callback();
                    }
                }

                if (debug) {
                    data.toString().split(/\n/).forEach((line: string) => {
                        ffmpegLogger.debug(line);
                    });
                }
            });
        }

        this.process.on('error', (error: Error) => {
            ffmpegLogger.error('Failed to start stream: ' + error.message);
            if (callback) {
                callback(new Error('FFmpeg process creation failed'));
            }
            delegate.stopStream(sessionId);
        });

        this.process.on('exit', (code: number, signal: NodeJS.Signals) => {
            const message = 'FFmpeg exited with code: ' + code + ' and signal: ' + signal;

            if (code == null || code === 255) {
                if (this.process.killed) {
                    ffmpegLogger.debug(message + ' (Expected)');
                } else {
                    ffmpegLogger.error(message + ' (Unexpected)');
                }
            } else {
                ffmpegLogger.error(message + ' (Error)');
                delegate.stopStream(sessionId);
                if (!started && callback) {
                    callback(new Error(message));
                } else {
                    delegate.getController().forceStopStreamingSession(sessionId);
                }
            }
        });
    }

    public stop(): void {
        this.process.kill('SIGKILL');
    }

    getStdin(): Writable | null {
        return this.process.stdin;
    }
}