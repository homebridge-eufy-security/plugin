import { Component, Input, OnInit } from '@angular/core';
import { L_Device } from '../../../app/util/types';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-force-refreshsnap',
    templateUrl: './force-refreshsnap.component.html',
    standalone: true,
    imports: [FormsModule],
})
export class ForceRefreshsnapComponent extends ConfigOptionsInterpreter implements OnInit {
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

  @Input() device?: L_Device;
  value = false;

  async readValue() {
    const config = await this.getCameraConfig(this.device?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'forcerefreshsnap')) {
      this.value = config['forcerefreshsnap'];
    }
  }

  update() {
    this.updateDeviceConfig(
      {
        forcerefreshsnap: this.value,
      },
      this.device!,
    );
  }
}
