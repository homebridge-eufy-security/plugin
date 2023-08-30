import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { DEFAULT_CONFIG_VALUES } from '../../../app/util/default-config-values';

@Component({
  selector: 'app-unbridge-accessory',
  templateUrl: './unbridge-accessory.component.html',
})
export class UnbridgeAccessoryComponent extends ConfigOptionsInterpreter implements OnInit {
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

  model = false;

  readValue() {
    const unbridgeValue = Object.prototype.hasOwnProperty.call(this.config, 'unbridge')
      ? this.config['unbridge']
      : DEFAULT_CONFIG_VALUES.unbridge;
    this.model = unbridgeValue;
  }

  update() {
    this.updateConfig({
      unbridge: this.model,
    });
  }
}
