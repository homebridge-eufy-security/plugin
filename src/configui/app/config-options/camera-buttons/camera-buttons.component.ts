import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

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

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'enableButton')) {
      this.enableCameraButton = config['enableButton'];
    }
    if (config && Object.prototype.hasOwnProperty.call(config, 'motionButton')) {
      this.enableMotionButton = config['motionButton'];
    }
  }

  update() {
    this.updateConfig(
      {
        enableButton: this.enableCameraButton,
        motionButton: this.enableMotionButton,
      },
      this.accessory,
    );
  }
}
