import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../../app/util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-immediate-notification-on-ring',
  templateUrl: './immediate-notification-on-ring.component.html',
  styles: [],
})
export class ImmediateNotificationOnRingComponent extends ConfigOptionsInterpreter implements OnInit {
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
  value = DEFAULT_CAMERACONFIG_VALUES.immediateRingNotificationWithoutSnapshot;

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'immediateRingNotificationWithoutSnapshot')) {
      this.value = config['immediateRingNotificationWithoutSnapshot'];
    }
  }

  update() {
    this.updateConfig(
      {
        immediateRingNotificationWithoutSnapshot: this.value,
      },
      this.accessory,
    );
  }
}
