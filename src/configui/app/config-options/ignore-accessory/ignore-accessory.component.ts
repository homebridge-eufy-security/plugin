import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { L_Device, L_Station } from '../../../app/util/types';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-ignore-accessory',
  templateUrl: './ignore-accessory.component.html',
  standalone: true,
  imports: [FormsModule],
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

  @Input() accessory?: L_Station | L_Device;
  @Input() station?: boolean;
  @Output() ignored = new EventEmitter<boolean>();
  value = false;

  async readValue() {
    this.config = await this.pluginService.getConfig();
    if (this.accessory) {
      const identifier = this.station ? 'ignoreStations' : 'ignoreDevices';
      if (Array.isArray(this.config[identifier])) {
        this.value = this.config[identifier].find((uId: string) => uId === this.accessory!.uniqueId) !== undefined;
      }
    }
  }

  async update() {
    if (!this.accessory) {
      return;
    }

    this.ignored.emit(this.value); // Warn the parent app to show or hide the camera settings menu

    const identifier = this.station ? 'ignoreStations' : 'ignoreDevices';
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
