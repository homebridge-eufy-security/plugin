import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface';

import { L_Device, L_Station } from './util/types';

@Injectable({
  providedIn: 'root',
})
export class PluginService extends EventTarget {
  private stations: L_Station[] = [];

  private accessories$ = new Observable<Event>((subscriber) => { // Explicitly typing the Observable to emit Event
    const handler = (event: Event) => subscriber.next(event);
    window.homebridge.addEventListener('addAccessory', handler);
    return () => {
      window.homebridge.removeEventListener('addAccessory', handler);
    };
  });

  public config: PluginConfig[] = [{
    "platform": "EufySecurity",
    "name": "EufySecurity"
  }];

  constructor() {
    super();
    this.init();
  }

  private init() {

    this.getPlatformConfig();

    this.accessories$.subscribe((value: Event) => {
      const v = value as MessageEvent;
      this.stations = v.data;
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
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private addAccessory(station: L_Station) {
    if (!this.stations.find((a) => a.uniqueId === station.uniqueId)) {
      this.stations.push(station);
    }
  }

  public getConfig(): PluginConfig {
    // always use the first platform config since there is only one supported
    return this.config[0];
  }

  public async updateConfig(config: PluginConfig): Promise<void> {
    try {
      this.config = [config];
      await window.homebridge.updatePluginConfig(this.config);
      this.dispatchEvent(new Event('configChanged'));
    } catch (error) {
      console.log('There was an error updating your config: ', error, this.config);
    }
  }

  private async getPlatformConfig(): Promise<PluginConfig[]> {
    try {
      const newConfig = await window.homebridge.getPluginConfig();
      this.config = newConfig.length > 0 ? newConfig : this.config;
    } catch (error) {
      console.error('Error fetching plugin config:', error);
    }
    return this.config;
  }

  /**
   * Saves the configuration changes made by the user.
   * 
   * @returns A Promise that resolves when the configuration is successfully saved.
   */
  public async saveConfig(): Promise<void> {
    try {
      await window.homebridge.savePluginConfig();
    } catch (error) {
      console.log('There was an error when saving config: ', error);
    }
  }

  /**
   * Resets the configuration to default settings.
   * 
   * @returns A Promise that resolves when the configuration is successfully reset.
   */
  public async resetConfig(): Promise<void> {
    try {
      await window.homebridge.updatePluginConfig([{}]);
      await window.homebridge.savePluginConfig();
    } catch (error) {
      console.log('There was an error when reseting config: ', error);
    }
  }
}
