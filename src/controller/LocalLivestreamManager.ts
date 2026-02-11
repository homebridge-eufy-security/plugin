import { Readable } from 'stream';
import { Station, Device, StreamMetadata, EufySecurity } from 'eufy-security-client';
import { CameraAccessory } from '../accessories/CameraAccessory.js';
import { Deferred } from '../utils/utils.js';
import { ILogObj, Logger } from 'tslog';

/** Internal state: streams plus a timestamp for dedup/reuse logic. */
interface ActiveStream {
  videostream: Readable;
  audiostream: Readable;
  createdAt: number;
}

/** Data returned to consumers — only the streams they need. */
export type LivestreamData = Pick<ActiveStream, 'videostream' | 'audiostream'>;

const P2P_TIMEOUT_MS = 15_000;
const DUPLICATE_STREAM_GUARD_S = 5;

export class LocalLivestreamManager {
  private stationStream: ActiveStream | null = null;
  private pending: { deferred: Deferred<LivestreamData>; timer: NodeJS.Timeout } | null = null;

  private readonly eufyClient: EufySecurity;
  private readonly log: Logger<ILogObj>;
  private readonly serialNumber: string;

  constructor(camera: CameraAccessory) {
    this.eufyClient = camera.platform.eufyClient;
    this.serialNumber = camera.device.getSerial();
    this.log = camera.log;

    this.log.debug(`LocalLivestreamManager initialized for ${camera.device.getName()} (serial: ${this.serialNumber})`);

    this.eufyClient.on('station livestream start', this.onStationLivestreamStart);
    this.eufyClient.on('station livestream stop', this.onStationLivestreamStop);
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
  public async getLocalLiveStream(): Promise<LivestreamData> {
    if (this.stationStream) {
      const runtime = ((Date.now() - this.stationStream.createdAt) / 1000).toFixed(1);
      this.log.debug(`Reusing livestream started ${runtime}s ago.`);
      return this.stationStream;
    }
    return this.startLocalLiveStream();
  }

  /**
   * Requests a P2P livestream from the eufy station and waits for the
   * 'station livestream start' event.  If a start is already in progress,
   * the caller piggy-backs on the existing promise instead of issuing a
   * duplicate request.
   */
  private startLocalLiveStream(): Promise<LivestreamData> {
    if (this.pending) {
      this.log.debug('Livestream already starting — waiting on existing request.');
      return this.pending.deferred.promise;
    }

    this.log.debug(`Starting station livestream for serial: ${this.serialNumber}...`);

    const deferred = new Deferred<LivestreamData>();
    const timer = setTimeout(() => {
      this.log.error(`Livestream timeout: no P2P stream event received within ${P2P_TIMEOUT_MS / 1000}s for serial ${this.serialNumber}.`);
      this.log.warn('If using a recent Node.js version, try enabling "Embedded PKCS1 Support" in the plugin settings.');
      this.settlePending('reject', 'Livestream timeout — try enabling Embedded PKCS1 Support in settings.');
    }, P2P_TIMEOUT_MS);

    this.pending = { deferred, timer };

    try {
      this.eufyClient.startStationLivestream(this.serialNumber);
    } catch (err) {
      this.log.error(`startStationLivestream threw: ${err}`);
      this.settlePending('reject', err);
    }

    return deferred.promise;
  }

  /**
   * Settle (resolve or reject) the pending start promise, clear the timer,
   * and optionally stop the livestream on rejection.
   */
  private settlePending(action: 'resolve', value: LivestreamData): void;
  private settlePending(action: 'reject', reason: unknown): void;
  private settlePending(action: 'resolve' | 'reject', payload: unknown): void {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = null;

    if (action === 'resolve') {
      p.deferred.resolve(payload as LivestreamData);
    } else {
      p.deferred.reject(payload instanceof Error ? payload : new Error(String(payload)));
      this.stopLocalLiveStream();
    }
  }

  public stopLocalLiveStream(): void {
    this.log.debug('Stopping station livestream.');
    this.eufyClient.stopStationLivestream(this.serialNumber);
    this.destroyStreams();
  }

  /** True when the event belongs to this camera instance. */
  private isOwnDevice(device: Device): boolean {
    return device.getSerial() === this.serialNumber;
  }

  private onStationLivestreamStop = (_station: Station, device: Device): void => {
    if (!this.isOwnDevice(device)) return;
    this.log.debug(`Station livestream for ${device.getName()} has stopped.`);
    this.destroyStreams();
  };

  private onStationLivestreamStart = (
    station: Station,
    device: Device,
    metadata: StreamMetadata,
    videostream: Readable,
    audiostream: Readable,
  ): void => {
    if (!this.isOwnDevice(device)) return;

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

    this.log.debug(`${station.getName()} P2P livestream for ${device.getName()} started.`);
    this.log.debug('Stream metadata:', JSON.stringify(metadata));

    this.stationStream = { videostream, audiostream, createdAt: Date.now() };
    this.settlePending('resolve', this.stationStream);
  };
}