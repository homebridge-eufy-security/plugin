import { Component, Input, OnInit } from '@angular/core';
import { L_Device } from '../../../app/util/types';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES, DEFAULT_CONFIG_VALUES } from '../../../app/util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

import { faPlusCircle, faMinusCircle, faCircle } from '@fortawesome/free-solid-svg-icons';
import { AccessoryService } from '../../accessory.service';
import { ChargingType } from '../../util/types';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { RouterLink } from '@angular/router';
import { NgIf, NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-snapshot-handling-method',
    templateUrl: './snapshot-handling-method.component.html',
    styles: [],
    standalone: true,
    imports: [
        FormsModule,
        NgIf,
        RouterLink,
        NgFor,
        FaIconComponent,
    ],
})
export class SnapshotHandlingMethodComponent extends ConfigOptionsInterpreter implements OnInit {
  @Input() device?: L_Device;

  constructor(
    pluginService: PluginService,
    private accessoryService: AccessoryService,
  ) {
    super(pluginService);
  }

  ngOnInit(): void {
    this.readValue();
  }

  // Custom icons
  plusIcon = faPlusCircle;
  minusIcon = faMinusCircle;
  mediumIcon = faCircle;

  value = DEFAULT_CAMERACONFIG_VALUES.snapshotHandlingMethod;

  chargingStatus = ChargingType.PLUGGED;
  camerasOnSameStation: string[] = [];

  ignoreMultipleDevicesWarning = DEFAULT_CONFIG_VALUES.ignoreMultipleDevicesWarning;

  async readValue() {
    const uniqueId = this.device?.uniqueId || '';
    const config = await this.getCameraConfig(uniqueId);

    // Check for ignoreMultipleDevicesWarning in config using hasOwnProperty
    if (config && Object.prototype.hasOwnProperty.call(config, 'ignoreMultipleDevicesWarning')) {
      this.ignoreMultipleDevicesWarning = config['ignoreMultipleDevicesWarning'];
    }

    if (this.device) {
      // Get charging status asynchronously
      this.accessoryService.getChargingStatus(this.device.uniqueId)
        .then((chargingStatus) => this.chargingStatus = chargingStatus);
      
      // Check for snapshotHandlingMethod or forcerefreshsnap in config using hasOwnProperty
      if (config) {
        if (Object.prototype.hasOwnProperty.call(config, 'snapshotHandlingMethod')) {
          this.value = config['snapshotHandlingMethod'];
        } else if (Object.prototype.hasOwnProperty.call(config, 'forcerefreshsnap')) {
          this.value = config['forcerefreshsnap'] ? 1 : 3;
        }
      }

      // Get cameras on the same station and handle multiple devices
      const ignoredDevices = (config && Object.prototype.hasOwnProperty.call(config, 'ignoreDevices')) ? config['ignoreDevices'] : [];
      this.accessoryService.getCamerasOnSameStation(this.device.uniqueId, ignoredDevices)
        .then(devices => {
          this.camerasOnSameStation = devices;
          if (this.camerasOnSameStation.length > 1 && !this.ignoreMultipleDevicesWarning) {
            this.value = 3;
            this.update();
          }
        });
    }
  }

  update() {
    // Update the configuration with snapshotHandlingMethod
    this.updateDeviceConfig(
      {
        snapshotHandlingMethod: this.value,
      },
      this.device!,
    );
  }
}