import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CONFIG_VALUES } from '../../util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-ignore-multiple-devices-warning',
    templateUrl: './ignore-multiple-devices-warning.component.html',
    styles: [],
    standalone: true,
    imports: [FormsModule],
})
export class IgnoreMultipleDevicesWarningComponent extends ConfigOptionsInterpreter implements OnInit {
  value = DEFAULT_CONFIG_VALUES.ignoreMultipleDevicesWarning;

  constructor(pluginService: PluginService) {
    super(pluginService);
  }

  ngOnInit(): void {
    this.readValue();
  }

  /** Customize from here */
  // This function reads the 'ignoreMultipleDevicesWarning' value from the config object
  readValue() {
    if (this.config && this.config['ignoreMultipleDevicesWarning'] !== undefined) {
      this.value = this.config['ignoreMultipleDevicesWarning'];
    }
  }

  // This function updates the 'ignoreMultipleDevicesWarning' value in the config object
  update() {
    this.updateConfig({
      ignoreMultipleDevicesWarning: this.value,
    });
  }
}