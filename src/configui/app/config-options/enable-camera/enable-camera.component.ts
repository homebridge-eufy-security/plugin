import { Component, OnInit, Input } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

import { Device } from '../../../app/util/eufy-security-client.utils';

@Component({
  selector: 'app-enable-camera',
  templateUrl: './enable-camera.component.html',
})
export class EnableCameraComponent extends ConfigOptionsInterpreter implements OnInit {
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
  value = false;
  disabled = false;

  async readValue() {
    if (this.accessory && Device.isDoorbell(this.accessory.type)) {
      this.value = true;
      this.disabled = true;
      this.update();
    }

    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'enableCamera')) {
      this.value = config['enableCamera'];
    }
  }

  update() {
    this.updateConfig(
      {
        enableCamera: this.value,
      },
      this.accessory,
    );
  }
}
