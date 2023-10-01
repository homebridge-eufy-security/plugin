/* eslint-disable max-len */

import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../util/default-config-values';
import { AccessoryService } from '../../accessory.service';

interface ButtonConfig {
  name: string;
  description: string;
  value: boolean;
  propertyName: string;
}

@Component({
  selector: 'app-camera-buttons',
  templateUrl: './camera-buttons.component.html',
})
export class CameraButtonsComponent extends ConfigOptionsInterpreter implements OnInit {
  @Input() accessory?: Accessory;

  buttonConfigs: ButtonConfig[] = [
    { name: 'Enable', description: 'camera', value: DEFAULT_CAMERACONFIG_VALUES.enableButton, propertyName: 'DeviceEnabled' },
    { name: 'Motion', description: 'detection', value: DEFAULT_CAMERACONFIG_VALUES.motionButton, propertyName: 'DeviceMotionDetection' },
    { name: 'Light', description: 'light', value: DEFAULT_CAMERACONFIG_VALUES.lightButton, propertyName: 'DeviceLight' },
    { name: 'IndoorChime', description: 'indoor chime', value: DEFAULT_CAMERACONFIG_VALUES.indoorChimeButton, propertyName: 'DeviceChimeIndoor' },
  ];

  constructor(
    pluginService: PluginService,
    private accessoryService: AccessoryService,
  ) {
    super(pluginService);
  }

  async ngOnInit(): Promise<void> {
    await this.readValue();
  }

  async readValue(): Promise<void> {
    const uniqueId = this.accessory?.uniqueId ?? '';
    const config = await this.getCameraConfig(uniqueId);

    // Create a new array without the buttonConfig if catch is fired
    const updatedButtonConfigs: ButtonConfig[] = [];

    await Promise.all(this.buttonConfigs.map(async (buttonConfig) => {
      if (this.accessory) {
        try {
          if (await this.accessoryService.hasProperty(this.accessory.uniqueId, buttonConfig.propertyName)) {

            if (Object.prototype.hasOwnProperty.call(config, buttonConfig.name)) {
              buttonConfig.value = config[buttonConfig.name] ?? buttonConfig.value;
            }

            updatedButtonConfigs.push(buttonConfig);
          }
        } catch (error) {
          // The catch block is executed when the property does not exist,
          // so the buttonConfig is not added to the updatedButtonConfigs array
        }
      }
    }));

    this.buttonConfigs = updatedButtonConfigs; // Update the buttonConfigs array
  }

  update(): void {
    const updated: Record<string, boolean | undefined> = {};
    this.buttonConfigs.forEach((buttonConfig) => {
      updated[buttonConfig.name.toLowerCase()] = buttonConfig.value;
    });

    this.updateConfig(updated, this.accessory);
  }
}