/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface';
import { Accessory } from '../accessory';
import { PluginService } from '../plugin.service';

export class ConfigOptionsInterpreter {
  config: PluginConfig;

  constructor(protected pluginService: PluginService) {
    this.config = {};
    this.pluginService
      .getConfig()
      .then((config) => {
        this.config = config;
      })
      .catch((err) => console.log('Could not get config in config interpreter: ' + err));
  }

  protected async getCameraConfig(uniqueId: string): Promise<any> {
    const config = await this.pluginService.getConfig();

    if (Array.isArray(config['cameras'])) {
      return Promise.resolve(config['cameras'].find((cc) => cc['serialNumber'] === uniqueId));
    } else {
      return Promise.resolve(undefined);
    }
  }

  protected async getStationConfig(uniqueId: string): Promise<any> {
    const config = await this.pluginService.getConfig();

    if (Array.isArray(config['stations'])) {
      return Promise.resolve(config['stations'].find((sc) => sc['serialNumber'] === uniqueId));
    } else {
      return Promise.resolve(undefined);
    }
  }

  protected async updateConfig(options: any, accessory?: Accessory) {
    // TODO: test extensively
    // TODO: remove config since it initializes too late if member was inputed to child --> stack overflow
    let config = await this.pluginService.getConfig();

    if (!accessory) {
      config = {
        ...config,
        ...options,
      };
    }

    if (accessory && accessory.station === false) {
      if (!Array.isArray(config['cameras'])) {
        config['cameras'] = [];
      }

      let cameraConfigIndex = -1;
      config['cameras'].forEach((cc: { serialNumber: string }, i: number) => {
        if (cc.serialNumber === accessory.uniqueId) {
          cameraConfigIndex = i;
        }
      });

      if (cameraConfigIndex >= 0) {
        // update cameraConfig for this device
        config['cameras'][cameraConfigIndex] = {
          ...config['cameras'][cameraConfigIndex],
          ...options,
        };
      } else {
        // cameraConfig for this device didn't exist yet
        config['cameras'].push({
          serialNumber: accessory.uniqueId,
          ...options,
        });
      }
    } else if (accessory && accessory.station === true) {
      if (!Array.isArray(config['stations'])) {
        config['stations'] = [];
      }

      let stationConfigIndex = -1;
      config['stations'].forEach((sc: { serialNumber: string }, i: number) => {
        if (sc.serialNumber === accessory.uniqueId) {
          stationConfigIndex = i;
        }
      });

      if (stationConfigIndex >= 0) {
        // update stationConfig for this device
        config['stations'][stationConfigIndex] = {
          ...config['stations'][stationConfigIndex],
          ...options,
        };
      } else {
        // stationConfig for this device didn't exist yet
        config['stations'].push({
          serialNumber: accessory.uniqueId,
          ...options,
        });
      }
    }

    this.pluginService.updateConfig(config);
  }
}
