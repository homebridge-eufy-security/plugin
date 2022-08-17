import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-experimental-mode',
  templateUrl: './experimental-mode.component.html',
  styles: [
  ],
})
export class ExperimentalModeComponent extends ConfigOptionsInterpreter implements OnInit {

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

  value = false;

  readValue() {
    if (Object.prototype.hasOwnProperty.call(this.config, 'experimentalMode')) {
      this.value = this.config['experimentalMode'];
    }
  }

  update() {
    this.updateConfig({
      experimentalMode: this.value,
    });
  }

}
