import EventEmitter from 'events';
import fs from 'fs';
import net from 'net';

import { Device, EufySecurity, Station, PropertyName } from 'eufy-security-client';
import pickPort from 'pick-port';

import { EufyClientNotRunningError, PluginConfigInteractor } from './interfaces';
import { Logger } from './logger';
import bunyan from 'bunyan';

enum InteractorRequestType {
  DeviceChargingStatus = 'deviceChargingStatus'
}

type InteractorRequest = {
  serialNumber: string;
  type: InteractorRequestType;
};

type InteractorResponse = {
  serialNumber: string;
  type: InteractorRequestType;
  result?: boolean;
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

    let accessory: Device | Station | undefined = undefined;

    try {
      switch (request.type) {
        case InteractorRequestType.DeviceChargingStatus:

          accessory = await this.client.getDevice(request.serialNumber);
          if (!accessory.hasBattery()) {
            // device has no battery, so it is always powered with plug
            response.result = true;
          } else if (accessory.hasProperty(PropertyName.DeviceBatteryIsCharging)) {
            response.result = accessory.getPropertyValue(PropertyName.DeviceBatteryIsCharging) as boolean;
          } else {
            response.error = new Error('battery charging property could not be retrieved');
          }
          break;
      
        default:
          response.error = new Error('Request type not implemented.');
          break;
      }

    } catch (err) {
      response.error = err as Error;
    }

    return Promise.resolve(response);
  }

  private onSocketError(err: Error) {
    this.log.error(`There was an error on the PluginConfigInteractor socket: ${err}`);
  }

  private onServerError(err: Error) {
    this.log.error(`There was an error on the PluginConfigInteractor server: ${err}`);
  }
  
  async DeviceIsCharging(sn: string): Promise<boolean> {
    const request: InteractorRequest = {
      serialNumber: sn,
      type: InteractorRequestType.DeviceChargingStatus,
    };
    try {
      const response = await this.processDirectRequest(request);
      
      if (response.error) {
        return Promise.reject(response.error.message);
      }
      if (!response.result) {
        return Promise.reject('there was no result');
      }
  
      return Promise.resolve(response.result as boolean);
    } catch (err) {
      return Promise.reject(err);
    }
  }

}