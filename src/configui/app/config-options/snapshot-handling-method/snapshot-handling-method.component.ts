import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../../app/util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

import { faPlusCircle, faMinusCircle, faCircle } from '@fortawesome/free-solid-svg-icons';
import { AccessoryService } from '../../accessory.service';
import { ChargingStatus } from '../../util/eufy-security-client.utils';

@Component({
  selector: 'app-snapshot-handling-method',
  templateUrl: './snapshot-handling-method.component.html',
  styles: [],
})
export class SnapshotHandlingMethodComponent extends ConfigOptionsInterpreter implements OnInit {
  constructor(
    pluginService: PluginService,
    private accessoryService: AccessoryService,
  ) {
    super(pluginService);
  }

  ngOnInit(): void {
    this.readValue();
    
    if (this.accessory) {
      this.accessoryService.getChargingStatus(this.accessory.uniqueId)
        .then((chargingStatus) => this.chargingStatus = chargingStatus);
      
      this.accessoryService.getDevicesOnSameStation(this.accessory.uniqueId)
        .then(devices => {
          this.devicesOnSameStation = devices.length;
          if (this.devicesOnSameStation > 1) {
            this.value = 3;
            this.update();
          }
        });
    }
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

  chargingStatus = ChargingStatus.PLUGGED;
  devicesOnSameStation = 1;

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
