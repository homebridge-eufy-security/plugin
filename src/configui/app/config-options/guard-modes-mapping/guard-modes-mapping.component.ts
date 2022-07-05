import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CONFIG_VALUES } from '../../../app/util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-guard-modes-mapping',
  templateUrl: './guard-modes-mapping.component.html',
  styles: [],
})
export class GuardModesMappingComponent extends ConfigOptionsInterpreter implements OnInit {
  constructor(pluginService: PluginService) {
    super(pluginService);
  }

  ngOnInit(): void {
    this.readValue();
  }

  /** Customize from here */
  /** updateConfig() will overwrite any settings that you'll provide */
  /** Don't try and 'append'/'push' to arrays this way - add a custom method instead */
  /** see config option to ignore devices as example */

  /** updateConfig() takes an optional second parameter to specify the accessoriy for which the setting is changed */

  @Input() accessory?: Accessory;
  hkHome: number | undefined = undefined;
  hkAway: number | undefined = undefined;
  hkNight: number | undefined = undefined;
  hkOff: number | undefined = undefined;

  async readValue() {
    const config = this.accessory ? await this.getStationConfig(this.accessory.uniqueId) : await this.pluginService.getConfig();

    if (config && Object.prototype.hasOwnProperty.call(config, 'hkHome')) {
      this.hkHome = config['hkHome'];
    } else if (!this.accessory) {
      this.hkHome = DEFAULT_CONFIG_VALUES.hkHome;
    }
    if (config && Object.prototype.hasOwnProperty.call(config, 'hkAway')) {
      this.hkAway = config['hkAway'];
    } else if (!this.accessory) {
      this.hkAway = DEFAULT_CONFIG_VALUES.hkAway;
    }
    if (config && Object.prototype.hasOwnProperty.call(config, 'hkNight')) {
      this.hkNight = config['hkNight'];
    } else if (!this.accessory) {
      this.hkNight = DEFAULT_CONFIG_VALUES.hkNight;
    }
    if (config && Object.prototype.hasOwnProperty.call(config, 'hkOff')) {
      this.hkOff = config['hkOff'];
    } else if (!this.accessory) {
      this.hkOff = DEFAULT_CONFIG_VALUES.hkOff;
    }
  }

  async update() {
    let config = this.accessory ? await this.getStationConfig(this.accessory.uniqueId) : await this.pluginService.getConfig();
    if (config === undefined) {
      config = {};
    }

    if (this.hkHome === undefined && Object.prototype.hasOwnProperty.call(config, 'hkHome')) {
      delete config['hkHome'];
    } else {
      config['hkHome'] = this.hkHome;
    }
    if (this.hkAway === undefined && Object.prototype.hasOwnProperty.call(config, 'hkAway')) {
      delete config['hkAway'];
    } else {
      config['hkAway'] = this.hkAway;
    }
    if (this.hkNight === undefined && Object.prototype.hasOwnProperty.call(config, 'hkNight')) {
      delete config['hkNight'];
    } else {
      config['hkNight'] = this.hkNight;
    }
    if (this.hkOff === undefined && Object.prototype.hasOwnProperty.call(config, 'hkOff')) {
      delete config['hkOff'];
    } else {
      config['hkOff'] = this.hkOff;
    }

    let completeConfig = await this.pluginService.getConfig();

    if (this.accessory) {
      if (!Array.isArray(completeConfig['stations'])) {
        completeConfig['stations'] = [];
      }

      let stationIndex = -1;
      completeConfig['stations'].forEach((sc: { serialNumber: string }, i: number) => {
        if (sc.serialNumber === this.accessory?.uniqueId) {
          stationIndex = i;
        }
      });

      if (stationIndex >= 0) {
        completeConfig['stations'][stationIndex] = config;
      } else {
        config['serialNumber'] = this.accessory.uniqueId;
        completeConfig['stations'].push(config);
      }
    } else {
      completeConfig = config;
    }

    this.pluginService.updateConfig(completeConfig);
  }
}
