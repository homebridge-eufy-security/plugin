/* eslint-disable no-console */
import { Injectable } from '@angular/core';
import { fromEvent } from 'rxjs';

import { PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface';

import { Accessory, L_Device, L_Station } from './util/types';

@Injectable({
  providedIn: 'root',
})
export class PluginService extends EventTarget {
  private stations: L_Station[] = [];

  private accessories$ = fromEvent(window.homebridge, 'addAccessory');

  private config?: PluginConfig;

  constructor() {
    super();
    this.init();
  }

  private init() {
    this.accessories$.subscribe((event) => {
      this.loadStoredAccessories();
    });

    this.loadStoredAccessories();
  }

  public getStations(): L_Station[] {
    return this.stations;
  }

  public getStation(uniqueId: string | null): L_Station | undefined {
    return this.stations.find((s) => s.uniqueId === uniqueId);
  }

  public getDevice(uniqueId: string | null): L_Device | undefined {
    for (const station of this.stations) {
      if (station.devices) {
        const foundDevice = station.devices.find(device => device.uniqueId === uniqueId);
        if (foundDevice) {
          return foundDevice;
        }
      }
    }
    return undefined; // Device not found
  }

  public async loadStoredAccessories(): Promise<boolean> {
    try {
      const stations = (await window.homebridge.request('/storedAccessories')) as L_Station[];
      stations.forEach((station) => {
        this.addAccessory(station);
      });
      if (stations.length !== 0) {
        this.dispatchEvent(new Event('newAccessories'));
      }
      return Promise.resolve(stations.length !== 0);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  private addAccessory(station: L_Station) {
    if (!this.stations.find((a) => a.uniqueId === station.uniqueId)) {
      this.stations.push(station);
    }
  }

  public async getConfig(): Promise<PluginConfig> {
    if (this.config) {
      return Promise.resolve(this.config);
    }

    return this.getPlatformConfig();
  }

  public async updateConfig(config: PluginConfig, save?: boolean): Promise<void> {
    try {
      await window.homebridge.updatePluginConfig([config]);
      this.config = config;
      if (save) {
        await window.homebridge.savePluginConfig();
      }
      this.dispatchEvent(new Event('configChanged'));
    } catch (err) {
      console.log('There was an error updating the credentials in your config: ' + err);
    }
  }

  private async getPlatformConfig(): Promise<PluginConfig> {
    // always use the first platform config since there is only one supported
    try {
      const configs = await window.homebridge.getPluginConfig();

      if (configs.length > 0) {
        this.config = configs[0];
        this.config['platform'] = 'EufySecurity';
        return Promise.resolve(configs[0]);
      } else {
        return Promise.reject('Could not get Platform config');
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }
}
