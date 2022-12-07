/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { Device } from '../../util/eufy-security-client.utils';

@Component({
  selector: 'app-camera-buttons',
  templateUrl: './camera-buttons.component.html',
})
export class CameraButtonsComponent extends ConfigOptionsInterpreter implements OnInit {
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

  enableCameraButton = true;
  enableMotionButton = true;

  showIndoorChimeButtonSetting = false;
  indoorChimeButton = DEFAULT_CAMERACONFIG_VALUES.indoorChimeButton;

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (this.accessory) {
      this.showIndoorChimeButtonSetting = (Device.isBatteryDoorbell(this.accessory.type) || Device.isWiredDoorbell(this.accessory.type));
    }

    if (config && Object.prototype.hasOwnProperty.call(config, 'enableButton')) {
      this.enableCameraButton = config['enableButton'];
    }
    if (config && Object.prototype.hasOwnProperty.call(config, 'motionButton')) {
      this.enableMotionButton = config['motionButton'];
    }
    if (config && Object.prototype.hasOwnProperty.call(config, 'indoorChimeButton')) {
      this.indoorChimeButton = config['indoorChimeButton'];
    }
  }

  update() {
    const updated = {} as any;
    updated['enableButton'] = this.enableCameraButton;
    updated['motionButton'] = this.enableMotionButton;
    if (this.showIndoorChimeButtonSetting) {
      updated['indoorChimeButton'] = this.indoorChimeButton;
    }
    this.updateConfig(
      updated,
      this.accessory,
    );
  }
}
