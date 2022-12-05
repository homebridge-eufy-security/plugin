import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../plugin.service';
import { DEFAULT_CONFIG_VALUES } from '../../util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-sync-station-modes',
  templateUrl: './sync-station-modes.component.html',
  styles: [
  ],
})
export class SyncStationModesComponent extends ConfigOptionsInterpreter implements OnInit {

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

  value = DEFAULT_CONFIG_VALUES.syncStationModes;

  readValue() {
    if (Object.prototype.hasOwnProperty.call(this.config, 'syncStationModes')) {
      this.value = this.config['syncStationModes'];
    }
  }

  update() {
    this.updateConfig({
      syncStationModes: this.value,
    });
  }

}
