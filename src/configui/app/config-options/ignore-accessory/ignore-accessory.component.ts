import { Component, OnInit, Input } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-ignore-accessory',
  templateUrl: './ignore-accessory.component.html',
})
export class IgnoreAccessoryComponent extends ConfigOptionsInterpreter implements OnInit {
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
  value = false;

  async readValue() {
    this.config = await this.pluginService.getConfig();
    if (this.accessory) {
      const identifier = this.accessory.station ? 'ignoreStations' : 'ignoreDevices';
      if (Array.isArray(this.config[identifier])) {
        this.value = this.config[identifier].find((uId: string) => uId === this.accessory!.uniqueId) !== undefined;
      }
    }
  }

  async update() {
    if (!this.accessory) {
      return;
    }

    const identifier = this.accessory.station ? 'ignoreStations' : 'ignoreDevices';
    this.config = await this.pluginService.getConfig();
    if (this.value) {
      if (Array.isArray(this.config[identifier]) && !this.config[identifier].find((uId: string) => uId === this.accessory!.uniqueId)) {
        this.config[identifier].push(this.accessory.uniqueId);
      } else if (!Array.isArray(this.config[identifier])) {
        this.config[identifier] = [this.accessory.uniqueId];
      }
    } else {
      if (
        Array.isArray(this.config[identifier]) &&
        this.config[identifier].find((uId: string) => uId === this.accessory!.uniqueId) !== undefined
      ) {
        this.config[identifier] = this.config[identifier].filter((uId: string) => uId !== this.accessory!.uniqueId);
      }
    }

    this.pluginService.updateConfig(this.config);
  }
}
