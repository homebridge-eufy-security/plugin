import net from 'net';
import EventEmitter from 'events';

export class FFmpegProgress extends EventEmitter {
  private port: number;
  private server: net.Server;
  private started = false;

  constructor(port: number) {
    super();
    this.port = port;
    let killTimeout: NodeJS.Timeout | undefined = undefined;
    this.server = net.createServer((socket) => {
      if (killTimeout) {
        clearTimeout(killTimeout);
      }
      this.server.close(); // close server and terminate after connection is released

      socket.on('data', this.analyzeProgress.bind(this));

      socket.on('error', (err) => {
        // ignore since this is handled elsewhere
      });
    });

    killTimeout = setTimeout(() => {
      this.server.close();
    }, 5 * 60 * 1000);

    this.server.on('close', () => {
      this.emit('progress stopped');
    });

    this.server.on('error', (err) => {
      // ignore since this is handled elsewhere
    });

    this.server.listen(this.port);
  }

  private analyzeProgress(progressData: Buffer) {
    const progress = new Map<string, string>();
    progressData.toString().split(/\r?\n/).forEach((line) => {
      const split = line.split('=', 2);
      if (split.length !== 2) {
        return;
      }
      progress.set(split[0], split[1]);
    });

    if (!this.started) {
      if (progress.get('progress') !== undefined) {
        this.started = true;
        this.emit('progress started');
      }
    }
  }
}