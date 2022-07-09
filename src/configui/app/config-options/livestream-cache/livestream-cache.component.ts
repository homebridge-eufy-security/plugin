import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

import { DEFAULT_CAMERACONFIG_VALUES } from '../../util/default-config-values';

@Component({
  selector: 'app-livestream-cache',
  templateUrl: './livestream-cache.component.html',
})
export class LivestreamCacheComponent extends ConfigOptionsInterpreter implements OnInit {
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
  value = DEFAULT_CAMERACONFIG_VALUES.useCachedLocalLivestream;

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'useCachedLocalLivestream')) {
      this.value = config['useCachedLocalLivestream'];
    }
  }

  update() {
    this.updateConfig(
      {
        useCachedLocalLivestream: this.value,
      },
      this.accessory,
    );
  }
}
