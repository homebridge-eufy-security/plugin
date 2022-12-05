import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CONFIG_VALUES } from '../../util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-ignore-multiple-devices-warning',
  templateUrl: './ignore-multiple-devices-warning.component.html',
  styles: [
  ],
})
export class IgnoreMultipleDevicesWarningComponent extends ConfigOptionsInterpreter implements OnInit {

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

  value = DEFAULT_CONFIG_VALUES.ignoreMultipleDevicesWarning;

  readValue() {
    if (Object.prototype.hasOwnProperty.call(this.config, 'ignoreMultipleDevicesWarning')) {
      this.value = this.config['ignoreMultipleDevicesWarning'];
    }
  }

  update() {
    this.updateConfig({
      ignoreMultipleDevicesWarning: this.value,
    });
  }

}
