import { Component, Input, OnInit } from '@angular/core';
import { L_Device } from '../../../app/util/types';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../../app/util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-immediate-notification-on-ring',
    templateUrl: './immediate-notification-on-ring.component.html',
    styles: [],
    standalone: true,
    imports: [FormsModule],
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

  @Input() device?: L_Device;
  value = DEFAULT_CAMERACONFIG_VALUES.immediateRingNotificationWithoutSnapshot;

  async readValue() {
    const config = this.getCameraConfig(this.device?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'immediateRingNotificationWithoutSnapshot')) {
      this.value = config['immediateRingNotificationWithoutSnapshot'];
    }
  }

  update() {
    this.updateDeviceConfig(
      {
        immediateRingNotificationWithoutSnapshot: this.value,
      },
      this.device!,
    );
  }
}
