/* eslint-disable no-console */
import { Injectable } from '@angular/core';
import { fromEvent } from 'rxjs';

import { PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface';

import { Accessory } from './accessory';

@Injectable({
  providedIn: 'root',
})
export class PluginService extends EventTarget {
  private stations: Accessory[] = [];
  private devices: Accessory[] = [];

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

  public getStations(): Accessory[] {
    return this.stations;
  }

  public getDevices(): Accessory[] {
    return this.devices;
  }

  public getStation(uniqueId: string | null): Accessory | undefined {
    return this.stations.find((s) => s.uniqueId === uniqueId);
  }

  public getDevice(uniqueId: string | null): Accessory | undefined {
    return this.devices.find((d) => d.uniqueId === uniqueId);
  }

  public async loadStoredAccessories(): Promise<boolean> {
    try {
      const accessories = (await window.homebridge.request('/storedAccessories')) as Accessory[];
      accessories.forEach((accessory) => {
        this.addAccessory(accessory);
      });
      if (accessories.length !== 0) {
        this.dispatchEvent(new Event('newAccessories'));
      }
      return Promise.resolve(accessories.length !== 0);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  private addAccessory(accessory: Accessory) {
    const targetArray = accessory.station ? this.stations : this.devices;

    if (!targetArray.find((a) => a.uniqueId === accessory.uniqueId)) {
      targetArray.push(accessory);
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

  public async getCachedName(accessory: Accessory): Promise<string | undefined> {
    const cachedAccessories = await window.homebridge.getCachedAccessories();
    let name: string | undefined = undefined;
    cachedAccessories.forEach((cachedAccessory) => {
      if (
        cachedAccessory.context &&
        cachedAccessory.context['device'] &&
        cachedAccessory.context['device']['uniqueId'] === accessory.uniqueId &&
        cachedAccessory.context['device']['station'] === accessory.station
      ) {
        name = cachedAccessory.context['device']['displayName'];
      }
    });
    return Promise.resolve(name);
  }
}
