import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-polling-interval-minutes',
  templateUrl: './polling-interval-minutes.component.html',
})
export class PollingIntervalMinutesComponent extends ConfigOptionsInterpreter implements OnInit {
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

  value = 10;
  inputIsInvalid = false;

  readValue() {
    if (Object.prototype.hasOwnProperty.call(this.config, 'pollingIntervalMinutes')) {
      this.value = this.config['pollingIntervalMinutes'];
    }
  }

  update() {
    this.inputIsInvalid = false;
    if (!this.value || this.value < 0) {
      this.inputIsInvalid = true;
    }

    if (!this.inputIsInvalid) {
      this.updateConfig({
        pollingIntervalMinutes: this.value,
      });
    }
  }
}
