import { Component, OnInit, Input } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

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

  @Input() accessory?: Accessory;
  value = DEFAULT_CAMERACONFIG_VALUES.unbridge;

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'unbridge')) {
      this.value = config['unbridge'];
    }
  }

  update() {
    this.updateConfig(
      {
        unbridge: this.value,
      },
      this.accessory,
    );
  }
}
