import { Component, Input, OnInit } from '@angular/core';
import { L_Device } from '../../../app/util/types';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES, DEFAULT_CONFIG_VALUES } from '../../../app/util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

import { LucideAngularModule } from 'lucide-angular';
import { ChargingType } from '../../util/types';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-snapshot-handling-method',
  templateUrl: './snapshot-handling-method.component.html',
  styles: [],
  standalone: true,
  imports: [
    FormsModule,
    NgIf,
    LucideAngularModule,
  ],
})
export class SnapshotHandlingMethodComponent extends ConfigOptionsInterpreter implements OnInit {
  @Input() device?: L_Device;

  value = DEFAULT_CAMERACONFIG_VALUES.snapshotHandlingMethod;
  ignoreMultipleDevicesWarning = DEFAULT_CONFIG_VALUES.ignoreMultipleDevicesWarning;
  chargingStatus = ChargingType.PLUGGED;
  standalone = false;

  constructor(pluginService: PluginService) {
    super(pluginService);
  }

  async ngOnInit(): Promise<void> {
    await this.readValue();
  }

  async readValue() {
    const uniqueId = this.device?.uniqueId || '';

    if (this.device) {

      this.chargingStatus = this.device.chargingStatus!;
      this.standalone = this.device.standalone;

      this.ignoreMultipleDevicesWarning = this.config['ignoreMultipleDevicesWarning'] ?? this.ignoreMultipleDevicesWarning;

      const config = this.getCameraConfig(uniqueId);
      this.value = config['snapshotHandlingMethod'] ?? this.value;

      if (!this.ignoreMultipleDevicesWarning && !this.standalone) {
        this.value = 3;
        this.update();
      }

    }
  }

  update() {

    if (!this.ignoreMultipleDevicesWarning && !this.standalone) {
      this.value = 3;
    }

    // Update the configuration with snapshotHandlingMethod

    this.updateDeviceConfig(
      { snapshotHandlingMethod: this.value },
      this.device!,
    );
  }
}