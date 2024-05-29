import { CameraAccessory } from '../accessories/CameraAccessory';
import { ILogObj, Logger } from 'tslog';
import { Device, EufySecurity, PropertyName, Station, StreamMetadata } from 'eufy-security-client';
import { EventEmitter, Readable } from 'stream';
import { DoorbellAccessory } from '../accessories/DoorbellAccessory';

export interface EufyStream {
  args: string[],
  stdio?: Readable[],
}

// Define a type for the station stream data.
type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
  createdAt: number;
};

export abstract class EufyStreamer extends EventEmitter {
  protected token: string | undefined;
  protected log: Logger<ILogObj>;

  constructor(
    protected camera: CameraAccessory | DoorbellAccessory,
  ) {
    super();
    this.log = camera.log;
  }

  abstract initialize(): Promise<EufyStream>;
  abstract teardown(): void;
}

class RtspEufyStreamer extends EufyStreamer {
  async initialize(): Promise<EufyStream> {
    this.token = '0';
    return {
      args: [
        '-analyzeduration', '15000000',
        '-probesize', '100000000',
        '-i', this.camera.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl).toString()
      ],
    };
  }

  async teardown(): Promise<void> {
    this.log.debug('No need to stop RTSP stream');
  }
}

class LiveEufyStreamer extends EufyStreamer {
  private eufyClient: EufySecurity = {} as EufySecurity;
  private livestreamStartedAt: number | null = null;
  private stationStream: StationStream | null = null;

  constructor(
    protected camera: CameraAccessory | DoorbellAccessory,
  ) {
    super(camera);
    this.eufyClient = camera.platform.eufyClient;

    this.eufyClient.on('station livestream start', this.onStationLivestreamStart.bind(this));
    this.eufyClient.on('station livestream stop', this.onStationLivestreamStop.bind(this));
  }

  async initialize(): Promise<EufyStream> {

    this.eufyClient.startStationLivestream(this.camera.SN);

    const stationStream: StationStream = await new Promise((resolve, reject) => {
      this.log.debug('Start new station livestream...');

      // Hard stop
      const hardStop = setTimeout(
        () => {
          this.eufyClient.stopStationLivestream(this.camera.SN);
          reject('No livestream emited... Something wrong between HB and your cam! Firewall?');
        },
        15 * 1000 // After 10sec Apple HK will disconnect so all of this for nothing...
      );

      this.once('livestream start', async () => {
        if (this.stationStream !== null) {
          this.log.debug('New livestream started.');
          clearTimeout(hardStop);
          resolve(this.stationStream);
        } else {
          reject('no started livestream found');
        }
      });
    });

    if (!stationStream.videostream || !stationStream.audiostream) {
      throw new Error("Video or Audio stream is not available");
    }

    return {
      args: [
        '-analyzeduration', '15000000',
        '-probesize', '100000000',
      ],
      stdio: [stationStream.videostream, stationStream.audiostream],
    }
  }

  async teardown(): Promise<void> {
    try {
      // await this.camera.stopStream(this.token!);
    } catch (error: any) {
      this.log.error('Error stopping camera stream.', error);
    }

    try {
      await this.eufyClient.stopStationLivestream(this.camera.SN);
    } catch (error: any) {
      this.log.error('Error stopping Eufy station livestream.', error);
    }
  }

  // Handle the station livestream stop event.
  private onStationLivestreamStop(station: Station, device: Device) {
    if (device.getSerial() === this.camera.SN) {
      this.log.debug(`${station.getName()} station livestream for ${device.getName()} has stopped.`);
    }
  }

  // Handle the station livestream start event.
  private async onStationLivestreamStart(
    station: Station,
    device: Device,
    metadata: StreamMetadata,
    videostream: Readable,
    audiostream: Readable,
  ) {
    if (device.getSerial() === this.camera.SN) {
      if (this.stationStream) {
        const diff = (Date.now() - this.stationStream.createdAt) / 1000;
        if (diff < 5) {
          this.log.warn('Second livestream was started from station. Ignore.');
          return;
        }
      }

      this.log.debug(station.getName() + ' station livestream (P2P session) for ' + device.getName() + ' has started.');
      this.livestreamStartedAt = Date.now();
      this.stationStream = { station, device, metadata, videostream, audiostream, createdAt: this.livestreamStartedAt };
      this.log.debug('Stream metadata: ', this.stationStream.metadata);

      this.emit('livestream start');
    }
  }

}

export async function getStreamer(camera: CameraAccessory | DoorbellAccessory): Promise<EufyStreamer> {
  if (
    camera.device.hasPropertyValue(PropertyName.DeviceRTSPStream)
    && camera.device.hasPropertyValue(PropertyName.DeviceRTSPStreamUrl)
    && camera.device.getPropertyValue(PropertyName.DeviceRTSPStream)
    && camera.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) !== ''
  ) {
    return new RtspEufyStreamer(camera);
  }
  return new LiveEufyStreamer(camera);
}
