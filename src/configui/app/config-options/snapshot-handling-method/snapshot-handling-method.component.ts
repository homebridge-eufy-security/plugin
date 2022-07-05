import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../../app/util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

import { faPlusCircle, faMinusCircle, faCircle } from '@fortawesome/free-solid-svg-icons';

@Component({
  selector: 'app-snapshot-handling-method',
  templateUrl: './snapshot-handling-method.component.html',
  styles: [],
})
export class SnapshotHandlingMethodComponent extends ConfigOptionsInterpreter implements OnInit {
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

  plusIcon = faPlusCircle;
  minusIcon = faMinusCircle;
  mediumIcon = faCircle;

  @Input() accessory?: Accessory;
  value = DEFAULT_CAMERACONFIG_VALUES.snapshotHandlingMethod;

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'snapshotHandlingMethod')) {
      this.value = config['snapshotHandlingMethod'];
    } else if (config && Object.prototype.hasOwnProperty.call(config, 'forcerefreshsnap')) {
      this.value = config['forcerefreshsnap'] ? 1 : 3;
    }
  }

  update() {
    this.updateConfig(
      {
        snapshotHandlingMethod: this.value,
      },
      this.accessory,
    );
  }
}
