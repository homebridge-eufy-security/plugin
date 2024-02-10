import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { Device } from '../../util/eufy-security-client.utils';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../util/default-config-values';

interface UpdatedConfig {
  enableButton: boolean;
  motionButton: boolean;
  lightButton: boolean;
  indoorChimeButton?: boolean;
}

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

  @Input() accessory?: Accessory;

  enableCameraButton = true;
  enableMotionButton = true;
  enableLightButton = true;
  showIndoorChimeButtonSetting = false;
  indoorChimeButton = DEFAULT_CAMERACONFIG_VALUES.indoorChimeButton;

  async readValue(): Promise<void> {
    const config = await this.getCameraConfig(this.accessory?.uniqueId ?? '');

    if (this.accessory && this.accessory.type !== undefined) {
      this.showIndoorChimeButtonSetting = Device.isBatteryDoorbell(this.accessory.type) || Device.isWiredDoorbell(this.accessory.type);
    }

    if ('enableButton' in config) {
      this.enableCameraButton = config.enableButton;
    }

    if ('motionButton' in config) {
      this.enableMotionButton = config.motionButton;
    }

    if ('lightButton' in config) {
      this.enableLightButton = config.lightButton;
    }

    if ('indoorChimeButton' in config) {
      this.indoorChimeButton = config.indoorChimeButton;
    }
  }

  update(): void {
    const updated: UpdatedConfig = {
      enableButton: this.enableCameraButton,
      motionButton: this.enableMotionButton,
      lightButton: this.enableLightButton,
    };

    if (this.showIndoorChimeButtonSetting) {
      updated.indoorChimeButton = this.indoorChimeButton;
    }

    this.updateConfig(updated, this.accessory);
  }
}