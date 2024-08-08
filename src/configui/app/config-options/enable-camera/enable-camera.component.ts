import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { L_Device } from '../../../app/util/types';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-enable-camera',
  templateUrl: './enable-camera.component.html',
  standalone: true,
  imports: [FormsModule, NgIf],
})
export class EnableCameraComponent extends ConfigOptionsInterpreter implements OnInit {
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
  @Output() checkDeviceConfig = new EventEmitter<void>();
  value = 'true';
  disabled = false;

  async readValue() {
    const config = this.getCameraConfig(this.device?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'enableCamera')) {
      this.value = config['enableCamera'];
    }
  }

  update() {
    this.updateDeviceConfig(
      {
        enableCamera: JSON.parse(this.value),
      },
      this.device!,
    );
    this.checkDeviceConfig.emit(); // Warn the parent app to update his config
  }
}
