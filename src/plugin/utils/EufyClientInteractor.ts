import EventEmitter from 'events';
import fs from 'fs';
import net from 'net';

import { Device, EufySecurity, Station, PropertyName, PropertyValue } from '@homebridge-eufy-security/eufy-security-client';
import pickPort from 'pick-port';

import { EufyClientNotRunningError, PluginConfigInteractor } from './interfaces';
import { Logger as TsLogger, ILogObj } from 'tslog';

enum InteractorRequestType {
  DeviceChargingStatus = 'deviceChargingStatus',
  DeviceHasProperty = 'deviceHasProperty',
  GetStationDevicesMapping = 'stationDevicesMapping',
}

type InteractorRequest = {
  serialNumber: string;
  type: InteractorRequestType;
  value?: boolean;
  propertyName?: PropertyName;
};

type InteractorResponse = {
  serialNumber: string;
  type: InteractorRequestType;
  result?: boolean | number | string | { state: boolean; url?: string } | unknown;
  error?: Error;
};

export class EufyClientInteractor extends EventEmitter implements PluginConfigInteractor {

  private client?: EufySecurity;
  private storagePath: string;
  private log: TsLogger<ILogObj>;

  private server?: net.Server;

  constructor(path: string, log: TsLogger<ILogObj>, client?: EufySecurity) {
    super();

    this.log = log;
    this.storagePath = path;
    this.client = client;
  }

  public setClient(client: EufySecurity) {
    this.client = client;
  }

  public async setupServer(): Promise<void> {
    const port = await this.getFreePort();

    if (!this.writePortToStoragePath(port)) {
      return Promise.reject(new Error('Could not start interaction server'));
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        socket.on('data', (data) => {
          const request = JSON.parse(data.toString('utf-8')) as InteractorRequest;
          this.log.debug(`incoming Interaction Request: for ${request.serialNumber}, ${request}`);
          this.processIPCRequest(socket, request);
        });
        socket.on('error', this.onSocketError.bind(this));
      });

      this.server.on('error', this.onServerError.bind(this));

      this.server.listen(port, () => {
        this.log.debug(`Plugin-Config interaction server was started on port: ${port}`);
        resolve();
      });
    });
  }

  public stopServer() {
    if (this.server) {
      this.server.close();
    }
  }

  private async getFreePort(): Promise<number> {
    return await pickPort({
      type: 'tcp',
      ip: '0.0.0.0',
      reserveTimeout: 15,
    });
  }

  private writePortToStoragePath(port: number): boolean {
    try {
      fs.writeFileSync(this.storagePath + '/interaction.port', `${port}`, { encoding: 'utf-8' });
      return true;
    } catch (err) {
      return false;
    }
  }

  private loadPort(): number {
    try {
      const port = fs.readFileSync(this.storagePath + '/interaction.port', { encoding: 'utf-8' });
      return parseInt(port);
    } catch (err) {
      return -1;
    }
  }

  private ipcRequest(request: InteractorRequest): Promise<InteractorResponse> {
    this.log.debug(`Interaction Request: for ${request.serialNumber}, type: ${request.type}`);
    return new Promise((resolve, reject) => {
      const port = this.loadPort();
      if (port <= 0) {
        reject('Could not read port for interaction server');
      }

      const socket = net.createConnection(port, 'localhost', () => {
        socket.write(JSON.stringify(request));
      });

      const timeout = setTimeout(() => {
        socket.destroy();
        reject('no answer was retrieved from server');
      }, 10000);

      socket.on('error', (err) => {
        reject(err);
        socket.destroy();
      });

      socket.on('data', (data) => {
        const response = JSON.parse(data.toString('utf-8')) as InteractorResponse;
        if (response.serialNumber !== request.serialNumber || response.type !== request.type) {
          reject(new Error('invalid ipc response'));
        } else {
          resolve(response);
        }
        clearTimeout(timeout);
        socket.destroy();
      });
    });
  }

  private async processIPCRequest(socket: net.Socket, request: InteractorRequest) {

    if (!this.client) {
      const response: InteractorResponse = {
        serialNumber: request.serialNumber,
        type: request.type,
        error: new EufyClientNotRunningError('eufy client not running'),
      };
      socket.write(JSON.stringify(response));
      return;
    }

    let response: InteractorResponse = {
      serialNumber: request.serialNumber,
      type: request.type,
    };
    try {
      response = await this.processDirectRequest(request);
    } catch (err) {
      response.error = err as Error;
    }
    // eslint-disable-next-line max-len
    this.log.debug(`outgoing Interaction Response: for ${response.serialNumber}, type: ${response.type}, result: ${response.result}, error: ${response.error}`);
    socket.write(JSON.stringify(response));
  }

  private async processDirectRequest(request: InteractorRequest): Promise<InteractorResponse> {
    if (!this.client) {
      // forward to interaction server
      return this.ipcRequest(request);
    }

    const response: InteractorResponse = {
      serialNumber: request.serialNumber,
      type: request.type,
    };

    try {
      switch (request.type) {
        case InteractorRequestType.DeviceChargingStatus:
          response.result = await this.getChargingStatus(request);
          break;
        case InteractorRequestType.DeviceHasProperty:
          response.result = await this.hasProperty(request);
          break;
        case InteractorRequestType.GetStationDevicesMapping:
          response.result = await this.getStationCamerasMap(request);
          break;
        default:
          response.error = new Error('Request type not implemented.');
          break;
      }

    } catch (err) {
      response.error = err as Error;
    }

    // eslint-disable-next-line max-len
    this.log.debug(`Interaction Response: for ${response.serialNumber}, type: ${response}, error: ${response.error}`);
    return Promise.resolve(response);
  }

  private async getChargingStatus(request: InteractorRequest): Promise<number> {
    const device = await this.client!.getDevice(request.serialNumber);
    return new Promise((resolve, reject) => {
      if (!device.hasBattery()) {
        // device has no battery, so it is always powered with plug
        resolve(3);
      } else if (device.hasProperty(PropertyName.DeviceChargingStatus)) {
        resolve(device.getPropertyValue(PropertyName.DeviceChargingStatus) as number);
      } else {
        reject(new Error('battery charging property could not be retrieved'));
      }
    });
  }

  private async hasProperty(request: InteractorRequest): Promise<boolean> {
    const device = await this.client!.getDevice(request.serialNumber);
    return new Promise((resolve, reject) => {
      if (
        request.propertyName !== undefined
        && device.hasProperty(request.propertyName)
      ) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  }

  private async getStationCamerasMap(request: InteractorRequest): Promise<unknown> {
    try {
      const stations = this.client!.getStations();
      const devices = await this.client!.getDevices();
      const result = {};
      for (const device of devices) {
        if (!device.isCamera()) {
          continue;
        }
        const stationSN = device.getStationSerial();
        const devicesArray = result[stationSN];
        if (Array.isArray(devicesArray)) {
          devicesArray.push(device.getSerial());
        } else {
          result[stationSN] = [device.getSerial()];
        }
      }
      return Promise.resolve(result);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  private onSocketError(err: Error) {
    this.log.error(`There was an error on the PluginConfigInteractor socket: ${err}`);
  }

  private onServerError(err: Error) {
    this.log.error(`There was an error on the PluginConfigInteractor server: ${err}`);
  }

  async DeviceIsCharging(sn: string): Promise<number> {
    const request: InteractorRequest = {
      serialNumber: sn,
      type: InteractorRequestType.DeviceChargingStatus,
    };
    try {
      const response = await this.processDirectRequest(request);

      if (response.error) {
        return Promise.reject(response.error.message);
      }
      if (response.result === undefined) {
        return Promise.reject('there was no result');
      }

      return Promise.resolve(response.result as number);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  async DeviceHasProperty(sn: string, propertyName: PropertyName): Promise<boolean> {
    const request: InteractorRequest = {
      serialNumber: sn,
      propertyName: propertyName,
      type: InteractorRequestType.DeviceHasProperty,
    };
    try {
      const response = await this.processDirectRequest(request);

      if (response.error) {
        return Promise.reject(response.error.message);
      }
      if (response.result === undefined) {
        return Promise.reject('there was no result');
      }

      return Promise.resolve(response.result as boolean);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  async GetStationCamerasMapping(): Promise<unknown> {
    const request: InteractorRequest = {
      serialNumber: '',
      type: InteractorRequestType.GetStationDevicesMapping,
    };
    try {
      const response = await this.processDirectRequest(request);

      if (response.error) {
        return Promise.reject(response.error.message);
      }
      if (response.result === undefined) {
        return Promise.reject('there was no result');
      }

      return Promise.resolve(response.result as unknown);
    } catch (err) {
      return Promise.reject(err);
    }
  }
}