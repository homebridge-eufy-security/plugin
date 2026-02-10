import { Readable } from 'stream';
import { Station, Device, StreamMetadata, EufySecurity } from 'eufy-security-client';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { ILogObj, Logger } from 'tslog';

export type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
  createdAt: number;
};

const P2P_TIMEOUT_MS = 15_000;
const DUPLICATE_STREAM_GUARD_S = 5;

export class LocalLivestreamManager {
  private stationStream: StationStream | null = null;
  private pendingStart: {
    resolve: (stream: StationStream) => void;
    reject: (reason: unknown) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  private readonly eufyClient: EufySecurity;
  public readonly log: Logger<ILogObj>;
  private readonly serialNumber: string;

  constructor(private camera: CameraAccessory) {
    this.eufyClient = camera.platform.eufyClient;
    this.serialNumber = camera.device.getSerial();
    this.log = camera.log;

    this.log.debug(`LocalLivestreamManager initialized for ${camera.device.getName()} (serial: ${this.serialNumber})`);

    this.eufyClient.on('station livestream start', this.onStationLivestreamStart.bind(this));
    this.eufyClient.on('station livestream stop', this.onStationLivestreamStop.bind(this));
  }

  /** Destroy active streams and reset state. */
  private destroyStreams(): void {
    if (this.stationStream) {
      this.stationStream.audiostream.unpipe();
      this.stationStream.audiostream.destroy();
      this.stationStream.videostream.unpipe();
      this.stationStream.videostream.destroy();
      this.stationStream = null;
    }
  }

  /** Return the active livestream, or start a new one. Concurrent callers share the same pending request. */
  public async getLocalLivestream(): Promise<StationStream> {
    if (this.stationStream) {
      const runtime = ((Date.now() - this.stationStream.createdAt) / 1000).toFixed(1);
      this.log.debug(`Reusing livestream started ${runtime}s ago.`);
      return this.stationStream;
    }
    return this.startLocalLivestream();
  }

  /**
   * Requests a P2P livestream from the eufy station and waits for the
   * 'station livestream start' event.  If a start is already in progress,
   * the caller piggy-backs on the existing promise instead of issuing a
   * duplicate request.
   */
  private startLocalLivestream(): Promise<StationStream> {
    if (this.pendingStart) {
      this.log.debug('Livestream already starting — waiting on existing request.');
      return new Promise((resolve, reject) => {
        const existing = this.pendingStart!;
        const origResolve = existing.resolve;
        const origReject = existing.reject;
        existing.resolve = (stream) => { origResolve(stream); resolve(stream); };
        existing.reject = (err) => { origReject(err); reject(err); };
      });
    }

    this.log.debug(`Starting station livestream for serial: ${this.serialNumber}...`);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.log.error(`Livestream timeout: no P2P stream event received within ${P2P_TIMEOUT_MS / 1000}s for serial ${this.serialNumber}.`);
        this.log.warn('If using a recent Node.js version, try enabling "Embedded PKCS1 Support" in the plugin settings.');
        this.failPendingStart('Livestream timeout — try enabling Embedded PKCS1 Support in settings.');
      }, P2P_TIMEOUT_MS);

      this.pendingStart = { resolve, reject, timer };

      try {
        this.eufyClient.startStationLivestream(this.serialNumber);
      } catch (err) {
        this.log.error(`startStationLivestream threw: ${err}`);
        this.failPendingStart(err);
      }
    });
  }

  /** Reject the pending start promise and clean up. */
  private failPendingStart(reason: unknown): void {
    if (!this.pendingStart) {
      return;
    }
    clearTimeout(this.pendingStart.timer);
    this.pendingStart.reject(reason);
    this.pendingStart = null;
    this.stopLocalLiveStream();
  }

  /** Resolve the pending start promise and clean up the timer. */
  private resolvePendingStart(stream: StationStream): void {
    if (!this.pendingStart) {
      return;
    }
    clearTimeout(this.pendingStart.timer);
    this.pendingStart.resolve(stream);
    this.pendingStart = null;
  }

  public stopLocalLiveStream(): void {
    this.log.debug('Stopping station livestream.');
    this.eufyClient.stopStationLivestream(this.serialNumber);
    this.destroyStreams();
  }

  private onStationLivestreamStop(_station: Station, device: Device): void {
    if (device.getSerial() !== this.serialNumber) {
      return;
    }
    this.log.debug(`Station livestream for ${device.getName()} has stopped.`);
    this.destroyStreams();
  }

  private onStationLivestreamStart(
    station: Station,
    device: Device,
    metadata: StreamMetadata,
    videostream: Readable,
    audiostream: Readable,
  ): void {
    if (device.getSerial() !== this.serialNumber) {
      return;
    }

    // Guard against duplicate events fired in quick succession.
    if (this.stationStream) {
      const elapsed = (Date.now() - this.stationStream.createdAt) / 1000;
      if (elapsed < DUPLICATE_STREAM_GUARD_S) {
        this.log.warn('Duplicate livestream event received — ignoring.');
        return;
      }
    }

    // Tear down any prior stream before storing the new one.
    this.destroyStreams();

    const createdAt = Date.now();
    this.stationStream = { station, device, metadata, videostream, audiostream, createdAt };

    this.log.debug(`${station.getName()} P2P livestream for ${device.getName()} started.`);
    this.log.debug('Stream metadata:', JSON.stringify(metadata));

    this.resolvePendingStart(this.stationStream);
  }
}