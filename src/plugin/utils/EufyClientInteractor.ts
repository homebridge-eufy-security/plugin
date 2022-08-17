import EventEmitter from 'events';
import fs from 'fs';
import net from 'net';

import { Device, EufySecurity, Station, PropertyName, PropertyValue } from 'eufy-security-client';
import pickPort from 'pick-port';

import { EufyClientNotRunningError, PluginConfigInteractor } from './interfaces';
import { Logger } from './logger';
import bunyan from 'bunyan';
import { initializeExperimentalMode } from './experimental';

enum InteractorRequestType {
  DeviceChargingStatus = 'deviceChargingStatus',
  DeviceChangeExperimentalRTSPStatus = 'deviceExperimentalRtspStatusChange',
  DeviceGetExperimentalRTSPStatus = 'deviceExperimentalRtspStatusGet',
}

type InteractorRequest = {
  serialNumber: string;
  type: InteractorRequestType;
  value?: boolean;
};

type InteractorResponse = {
  serialNumber: string;
  type: InteractorRequestType;
  result?: boolean | number | string | { state: boolean; url?: string };
  error?: Error;
};

export class EufyClientInteractor extends EventEmitter implements PluginConfigInteractor {
  
  private client?: EufySecurity;
  private storagePath: string;
  private log: Logger | bunyan;

  private server?: net.Server;

  constructor(path: string, log: Logger | bunyan, client?: EufySecurity) {
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
          this.log.debug(`incoming Interaction Request: for ${request.serialNumber}, type: ${request.type}`);
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
    } catch(err) {
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
        case InteractorRequestType.DeviceChangeExperimentalRTSPStatus:
          response.result = await this.getExperimentalRTSPStatusChangeResult(request);
          break;
        case InteractorRequestType.DeviceGetExperimentalRTSPStatus:
          response.result = await this.getExperimentalRTSPState(request);
          break;
        default:
          response.error = new Error('Request type not implemented.');
          break;
      }

    } catch (err) {
      response.error = err as Error;
    }

    // eslint-disable-next-line max-len
    this.log.debug(`Interaction Response: for ${response.serialNumber}, type: ${response.type}, result: ${response.result}, error: ${response.error}`);
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

  private async getExperimentalRTSPStatusChangeResult(request): Promise<string> {
    initializeExperimentalMode();

    const device = await this.client!.getDevice(request.serialNumber);
    const station = this.client!.getStation(device.getStationSerial());

    return new Promise((resolve, reject) => {
      if (request.value === undefined) {
        reject(new Error('no value was given'));
      } else if(!device.hasProperty(PropertyName.DeviceRTSPStream) &&
        !device.hasProperty(PropertyName['ExperimentalModification'])) {
  
        reject(new Error('device has no experimental rtsp setting'));
      } else {
        let to: NodeJS.Timeout | undefined = undefined;

        const propertyListener = (d: Device, name: string, value: PropertyValue) => {
          if (request.value) {
            if (device.getSerial() === d.getSerial() && name === PropertyName.DeviceRTSPStreamUrl) {
              if (to) {
                clearTimeout(to);
              }
              device.removeListener('property changed', propertyListener);
              resolve(value as string);
            }
          } else {
            if (device.getSerial() === d.getSerial() && name === PropertyName.DeviceRTSPStream && value === false) {
              if (to) {
                clearTimeout(to);
              }
              device.removeListener('property changed', propertyListener);
              resolve('');
            }
          }
        };

        to = setTimeout(() => {
          device.removeListener('property changed', propertyListener);
          reject(new Error('setting rtsp feature timed out'));
        }, 5000);

        device.on('property changed', propertyListener);

        station.setRTSPStream(device, request.value);
      }
    });
  }

  private async getExperimentalRTSPState(request: InteractorRequest): Promise<{ state: boolean; url?: string }> {
    initializeExperimentalMode();

    try {
      const device = await this.client!.getDevice(request.serialNumber);
      let state = device.getPropertyValue(PropertyName.DeviceRTSPStream) as boolean;
      const url = device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) as string;
      if (url && url !== '') {
        state = true;
      }
      return Promise.resolve({
        state: state,
        url: url,
      });
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

  async DeviceSetExperimentalRTSP(sn: string, value: boolean): Promise<string> {
    const request: InteractorRequest = {
      serialNumber: sn,
      type: InteractorRequestType.DeviceChangeExperimentalRTSPStatus,
      value: value,
    };
    try {
      const response = await this.processDirectRequest(request);
      
      if (response.error) {
        return Promise.reject(response.error.message);
      }
      if (response.result === undefined) {
        return Promise.reject('there was no result');
      }
  
      return Promise.resolve(response.result as string);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  async DeviceGetExperimentalRTSPStatus(sn: string): Promise<{ state: boolean; url?: string }> {
    const request: InteractorRequest = {
      serialNumber: sn,
      type: InteractorRequestType.DeviceGetExperimentalRTSPStatus,
    };
    try {
      const response = await this.processDirectRequest(request);
      
      if (response.error) {
        return Promise.reject(response.error.message);
      }
      if (response.result === undefined) {
        return Promise.reject('there was no result');
      }
  
      return Promise.resolve(response.result as { state: boolean; url?: string });
    } catch (err) {
      return Promise.reject(err);
    }
  }
}