/* eslint-disable @typescript-eslint/no-explicit-any */
import { PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface';
import { L_Device, L_Station } from '../util/types';
import { PluginService } from '../plugin.service';
import { DEFAULT_CONFIG_VALUES } from '../../app/util/default-config-values';

export class ConfigOptionsInterpreter {
  public config: PluginConfig;

  constructor(protected pluginService: PluginService) {
    this.config = this.pluginService.getConfig();
  }

  protected getCameraConfig(uniqueId: string): any {
    if (Array.isArray(this.config['cameras'])) {
      return this.config['cameras'].find((cc: any) => cc.serialNumber === uniqueId) || undefined;
    } else {
      return undefined;
    }
  }

  protected getStationConfig(uniqueId: string): any {
    if (Array.isArray(this.config['stations'])) {
      return this.config['stations'].find((sc: any) => sc.serialNumber === uniqueId) || undefined;
    } else {
      return undefined;
    }
  }

  protected async updateConfig(options: any) {

    this.config = {
      ...DEFAULT_CONFIG_VALUES,
      ...this.config,
      ...options,
    };

    console.log('config:', this.config);

    // Update the configuration
    await this.pluginService.updateConfig(this.config);
  }

  protected async updateAccessoryConfig(options: any, accessory: L_Station | L_Device, type: 'camera' | 'station') {
    let configArray: any[];

    if (type === 'camera') {
      if (!Array.isArray(this.config['cameras'])) {
        this.config['cameras'] = [];
      }
      configArray = this.config['cameras'];
    } else if (type === 'station') {
      if (!Array.isArray(this.config['stations'])) {
        this.config['stations'] = [];
      }
      configArray = this.config['stations'];
    } else {
      throw new Error('Unsupported accessory type');
    }

    const accessoryConfigIndex = configArray.findIndex((config: any) => config.serialNumber === accessory.uniqueId);

    if (accessoryConfigIndex >= 0) {
      // Update existing config
      configArray[accessoryConfigIndex] = {
        ...configArray[accessoryConfigIndex],
        ...options,
      };
    } else {
      // Add new config
      configArray.push({
        serialNumber: accessory.uniqueId,
        ...options,
      });
    }

    // Update the configuration
    await this.pluginService.updateConfig(this.config);
  }

  protected async updateStationConfig(options: any, accessory: L_Station): Promise<void> {
    await this.updateAccessoryConfig(options, accessory, 'station');
  }

  protected async updateDeviceConfig(options: any, accessory: L_Device): Promise<void> {
    await this.updateAccessoryConfig(options, accessory, 'camera');
  }

}