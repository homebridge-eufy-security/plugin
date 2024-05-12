import { Component, Input, OnInit } from '@angular/core';
import { L_Device } from '../../../app/util/types';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../../app/util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';
import { NgIf } from '@angular/common';

@Component({
  selector: 'app-periodic-snapshot-refresh',
  templateUrl: './periodic-snapshot-refresh.component.html',
  styles: [],
  standalone: true,
  imports: [FormsModule, NgIf],
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

  @Input() device?: L_Device;
  value = DEFAULT_CAMERACONFIG_VALUES.refreshSnapshotIntervalMinutes!;
  inputIsInvalid = false;

  async readValue() {
    const config = this.getCameraConfig(this.device?.uniqueId || '');

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

    this.updateDeviceConfig(
      { refreshSnapshotIntervalMinutes: this.value },
      this.device!,
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
