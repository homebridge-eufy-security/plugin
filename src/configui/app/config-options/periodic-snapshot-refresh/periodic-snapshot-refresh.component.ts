import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../../app/util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-periodic-snapshot-refresh',
  templateUrl: './periodic-snapshot-refresh.component.html',
  styles: [],
})
export class PeriodicSnapshotRefreshComponent extends ConfigOptionsInterpreter implements OnInit {
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
  value = DEFAULT_CAMERACONFIG_VALUES.refreshSnapshotIntervalMinutes;
  inputIsInvalid = false;

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'refreshSnapshotIntervalMinutes')) {
      this.value = config['refreshSnapshotIntervalMinutes'];
    }
  }

  switchSetting() {
    this.value = this.value === 0 ? 30 : 0;
    this.update();
  }

  update() {
    if (!this.validate()) {
      return;
    }

    this.updateConfig(
      {
        refreshSnapshotIntervalMinutes: this.value,
      },
      this.accessory,
    );
  }

  validate() {
    this.inputIsInvalid = false;
    if (this.value === null || this.value === undefined || (this.value < 5 && this.value !== 0)) {
      this.inputIsInvalid = true;
    }
    return !this.inputIsInvalid;
  }
}
