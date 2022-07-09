import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-enable-detailed-logging',
  templateUrl: './enable-detailed-logging.component.html',
})
export class EnableDetailedLoggingComponent extends ConfigOptionsInterpreter implements OnInit {
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
    if (Object.prototype.hasOwnProperty.call(this.config, 'enableDetailedLogging')) {
      this.model = this.config['enableDetailedLogging'];
    }
  }

  update() {
    this.updateConfig({
      enableDetailedLogging: this.model,
    });
  }
}
