import { once } from "events";
import { ChildProcess, SpawnOptions, spawn } from "child_process";
import { AddressInfo, createServer, Server, Socket } from "net";
import { ILogObj, Logger } from 'tslog';
import { defaultFfmpegPath } from '@homebridge/camera-utils';
import { EufyStream } from "./EufyStreamer";
import { Writable } from "stream";

interface MP4Atom {
  header: Buffer;
  length: number;
  type: string;
  data: Buffer;
}

export default class HksvStreamer {
  readonly server: Server;
  readonly ffmpegPath: string;
  readonly args: string[] = [];

  socket?: Socket;
  childProcess?: ChildProcess;
  destroyed = false;

  connectPromise: Promise<void>;
  connectResolve?: () => void;

  constructor(
    private log: Logger<ILogObj>,
    private eufyStream: EufyStream,
    audioOutputArgs: Array<string>,
    videoOutputArgs: Array<string>,
    private debugMode: boolean,
  ) {
    this.connectPromise = new Promise(resolve => this.connectResolve = resolve);

    this.server = createServer(this.handleConnection.bind(this));

    this.ffmpegPath = defaultFfmpegPath ?? 'ffmpeg';

    this.args.push(...eufyStream.args);

    this.args.push(...audioOutputArgs);

    this.args.push("-f", "mp4");
    this.args.push(...videoOutputArgs);
    this.args.push("-fflags",
      "+genpts",
      "-reset_timestamps",
      "1");
    this.args.push(
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    );
  }

  async start() {

    this.log.debug('HksvStreamer start command received.');

    const promise = once(this.server, "listening");
    this.server.listen(); // listen on random port
    await promise;

    if (this.destroyed) {
      return;
    }

    const port = (this.server.address() as AddressInfo).port;
    this.args.push("tcp://127.0.0.1:" + port);

    this.log.debug(this.ffmpegPath + " " + this.args.join(" "));

    let options: SpawnOptions = { env: process.env, stdio: 'pipe' };

    if (this.eufyStream.stdio) {
      options.stdio = ['ignore', 'inherit', 'inherit', 'pipe', 'pipe'];
    }

    this.childProcess = spawn(this.ffmpegPath, this.args, { env: process.env, stdio: 'pipe' });

    this.childProcess.on('error', (error: Error) => {
      this.log.error(error.message);
      this.handleDisconnect();
    });

    this.childProcess.on('exit', this.handleDisconnect.bind(this));

    if (
      this.childProcess.stdio
      && this.eufyStream.stdio
      && this.childProcess.stdio.length === 5
      && this.childProcess.stdio[3] instanceof Writable
      && this.childProcess.stdio[4] instanceof Writable
    ) {
      const [videoStream, audioStream] = this.eufyStream.stdio;

      if (this.eufyStream.stdio) {
        this.log.debug('Pipping stdio to FFmpeg process.');
        videoStream.pipe(this.childProcess.stdio[4]);
        audioStream.pipe(this.childProcess.stdio[3]);
      }
    } else {
      this.log.error('HksvStreamer failed to start stream: input to ffmpeg was provided as stdio, but the process does not support stdio.');
    }

    if (this.debugMode) {
      this.childProcess.stdout?.on("data", data => this.log.debug(data.toString()));
      this.childProcess.stderr?.on("data", data => this.log.debug(data.toString()));
    }
  }

  destroy() {
    this.log.debug('HksvStreamer destroy command received, ending process.');

    this.childProcess?.kill();
    this.childProcess = undefined;
    this.destroyed = true;
  }

  handleDisconnect() {
    this.log.debug('Socket destroyed.')
    this.socket?.destroy();
    this.socket = undefined;
  }

  handleConnection(socket: Socket): void {
    this.server.close(); // don't accept any further clients
    this.socket = socket;
    this.connectResolve?.();
  }

  /**
   * Generator for `MP4Atom`s.
   * Throws error to signal EOF when socket is closed.
   */
  async* generator(): AsyncGenerator<MP4Atom> {

    await this.connectPromise;

    if (!this.socket || !this.childProcess) {
      this.log.debug("Socket undefined " + !!this.socket + " childProcess undefined " + !!this.childProcess);
      throw new Error("Unexpected state!");
    }

    while (this.childProcess) {
      const header = await this.read(8);
      const length = header.readInt32BE(0) - 8;
      const type = header.slice(4).toString();
      const data = await this.read(length);

      yield {
        header: header,
        length: length,
        type: type,
        data: data,
      };
    }
  }

  async read(length: number): Promise<Buffer> {
    if (!this.socket) {
      throw Error("FFMPEG tried reading from closed socket!");
    }

    if (!length) {
      return Buffer.alloc(0);
    }

    const value = this.socket.read(length);
    if (value) {
      return value;
    }

    return new Promise((resolve, reject) => {

      const cleanup = () => {
        this.socket?.removeListener("readable", readHandler);
        this.socket?.removeListener("close", endHandler);
      };

      const readHandler = () => {
        const value = this.socket!.read(length);
        if (value) {
          cleanup();
          resolve(value);
        }
      };

      const endHandler = () => {
        cleanup();
        reject(new Error(`FFMPEG socket closed during read for ${length} bytes!`));
      };

      if (!this.socket) {
        throw new Error("FFMPEG socket is closed now!");
      }

      this.socket.on("readable", readHandler);
      this.socket.on("close", endHandler);
    });
  }
}