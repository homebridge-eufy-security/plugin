import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../accessory';
import { AccessoryService } from '../../accessory.service';
import { PluginService } from '../../plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../util/default-config-values';
import { ChargingStatus } from '../../util/eufy-security-client.utils';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-enable-hsv',
  templateUrl: './enable-hsv.component.html',
  styles: [
  ],
})
export class EnableHsvComponent extends ConfigOptionsInterpreter implements OnInit {

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

      this.accessoryService.getCamerasOnSameStation(this.accessory.uniqueId)
        .then(devices => {
          this.camerasOnSameStation = devices;
          if (this.camerasOnSameStation.length > 1) {
            this.value = false;
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

  @Input() accessory?: Accessory;
  value = DEFAULT_CAMERACONFIG_VALUES.hsv;

  chargingStatus = ChargingStatus.PLUGGED;
  camerasOnSameStation: string[] = [];

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'hsv')) {
      this.value = config['hsv'];
    }
  }

  update() {
    this.updateConfig(
      {
        hsv: this.value,
      },
      this.accessory,
    );
  }

}
