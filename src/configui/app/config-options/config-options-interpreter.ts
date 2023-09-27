/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface';
import { Accessory } from '../accessory';
import { PluginService } from '../plugin.service';
import { DEFAULT_CONFIG_VALUES } from '../../app/util/default-config-values';

export class ConfigOptionsInterpreter {
  config: PluginConfig;

  constructor(protected pluginService: PluginService) {
    // Initialize config with default values
    this.config = DEFAULT_CONFIG_VALUES;

    // Fetch the configuration asynchronously and update config
    this.pluginService
      .getConfig()
      .then((config) => {
        this.config = { ...this.config, ...config }; // Update config with fetched data
      })
      .catch((err) => console.log('Could not get config in config interpreter: ' + err));
  }

  protected async getCameraConfig(uniqueId: string): Promise<any> {
    const config = await this.pluginService.getConfig();

    if (Array.isArray(config['cameras'])) {
      return config['cameras'].find((cc: any) => cc.serialNumber === uniqueId) || undefined;
    } else {
      return undefined;
    }
  }

  protected async getStationConfig(uniqueId: string): Promise<any> {
    const config = await this.pluginService.getConfig();

    if (Array.isArray(config['stations'])) {
      return config['stations'].find((sc: any) => sc.serialNumber === uniqueId) || undefined;
    } else {
      return undefined;
    }
  }

  protected async updateConfig(options: any, accessory?: Accessory) {
    // Fetch the current configuration
    let config = await this.pluginService.getConfig();

    if (!accessory) {
      // Merge default values, current config, and options
      config = {
        ...DEFAULT_CONFIG_VALUES,
        ...config,
        ...options,
      };
    }

    if (accessory && accessory.station === false) {
      if (!Array.isArray(config['cameras'])) {
        config['cameras'] = [];
      }

      // Find the index of the camera config by serialNumber
      const cameraConfigIndex = config['cameras'].findIndex((cc: any) => cc.serialNumber === accessory.uniqueId);

      if (cameraConfigIndex >= 0) {
        // Update cameraConfig for this device
        config['cameras'][cameraConfigIndex] = {
          ...config['cameras'][cameraConfigIndex],
          ...options,
        };
      } else {
        // CameraConfig for this device didn't exist yet, so add it
        config['cameras'].push({
          serialNumber: accessory.uniqueId,
          ...options,
        });
      }
    } else if (accessory && accessory.station === true) {
      if (!Array.isArray(config['stations'])) {
        config['stations'] = [];
      }

      // Find the index of the station config by serialNumber
      const stationConfigIndex = config['stations'].findIndex((sc: any) => sc.serialNumber === accessory.uniqueId);

      if (stationConfigIndex >= 0) {
        // Update stationConfig for this device
        config['stations'][stationConfigIndex] = {
          ...config['stations'][stationConfigIndex],
          ...options,
        };
      } else {
        // StationConfig for this device didn't exist yet, so add it
        config['stations'].push({
          serialNumber: accessory.uniqueId,
          ...options,
        });
      }
    }

    // Update the configuration
    this.pluginService.updateConfig(config);
  }
}