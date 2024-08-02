import { Component, Input, OnInit } from '@angular/core';
import { L_Device } from '../../../app/util/types';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../util/default-config-values';
import { FormsModule } from '@angular/forms';
import { NgFor } from '@angular/common';

interface ButtonConfig {
  name: string;
  button: string;
  description: string;
  value: boolean;
  propertyName: keyof L_Device;
}

@Component({
  selector: 'app-camera-buttons',
  templateUrl: './camera-buttons.component.html',
  standalone: true,
  imports: [NgFor, FormsModule],
})
export class CameraButtonsComponent extends ConfigOptionsInterpreter implements OnInit {
  @Input() device?: L_Device;

  buttonConfigs: ButtonConfig[] = [
    { name: 'Enable', button: 'enableButton', description: 'camera', value: DEFAULT_CAMERACONFIG_VALUES.enableButton, propertyName: 'DeviceEnabled' },
    { name: 'Motion', button: 'motionButton', description: 'detection', value: DEFAULT_CAMERACONFIG_VALUES.motionButton, propertyName: 'DeviceMotionDetection' },
    { name: 'Light', button: 'lightButton', description: 'light', value: DEFAULT_CAMERACONFIG_VALUES.lightButton, propertyName: 'DeviceLight' },
    { name: 'IndoorChime', button: 'indoorChimeButton', description: 'indoor chime', value: DEFAULT_CAMERACONFIG_VALUES.indoorChimeButton!, propertyName: 'DeviceChimeIndoor' },
  ];

  constructor(
    pluginService: PluginService
  ) {
    super(pluginService);
  }

  ngOnInit(): void {
    this.readValue();
  }

  async readValue(): Promise<void> {
    const uniqueId = this.device?.uniqueId ?? '';
    const config = this.getCameraConfig(uniqueId);

    this.buttonConfigs = this.buttonConfigs.filter((buttonConfig) => {
      if (this.device && this.device[buttonConfig.propertyName]) {
        if (buttonConfig.button in config) {
          buttonConfig.value = config[buttonConfig.button] ?? buttonConfig.value;
        }
        return true; // Keep the buttonConfig
      } else {
        return false; // Remove the buttonConfig
      }
    });
  }

  update(): void {
    const updated: Record<string, boolean> = {};
    this.buttonConfigs.forEach(buttonConfig => {
      updated[buttonConfig.button] = buttonConfig.value;
    });

    this.updateDeviceConfig(updated, this.device!);
  }
}