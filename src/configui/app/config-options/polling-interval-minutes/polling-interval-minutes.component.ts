import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-polling-interval-minutes',
  templateUrl: './polling-interval-minutes.component.html',
  standalone: true,
  imports: [FormsModule],
})
export class PollingIntervalMinutesComponent extends ConfigOptionsInterpreter implements OnInit {
  constructor(pluginService: PluginService) {
    super(pluginService);
  }

  async ngOnInit(): Promise<void> {
    this.readValue();
  }

  /** Customize from here */
  /** updateConfig() will overwrite any settings that you'll provide */
  /** Don't try and 'append'/'push' to arrays this way - add a custom method instead */
  /** see config option to ignore devices as example */

  /** updateConfig() takes an optional second parameter to specify the accessoriy for which the setting is changed */

  pollingIntervalMinutes = 0;
  inputIsInvalid = false;

  readValue() {
    this.pollingIntervalMinutes = this.config['pollingIntervalMinutes'] ?? this.pollingIntervalMinutes;
  }

  update() {
    this.inputIsInvalid = false;
    if (!this.pollingIntervalMinutes || this.pollingIntervalMinutes < 0) {
      this.inputIsInvalid = true;
    }

    if (!this.inputIsInvalid) {
      this.updateConfig({
        pollingIntervalMinutes: this.pollingIntervalMinutes,
      });
    }
  }
}
