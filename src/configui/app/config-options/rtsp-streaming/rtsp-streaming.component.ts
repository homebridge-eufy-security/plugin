import { Component, Input, OnInit } from '@angular/core';
import { L_Device } from '../../../app/util/types';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-rtsp-streaming',
  templateUrl: './rtsp-streaming.component.html',
  standalone: true,
  imports: [FormsModule, NgIf],
})
export class RtspStreamingComponent extends ConfigOptionsInterpreter implements OnInit {
  constructor(pluginService: PluginService) {
    super(pluginService);
  }

  ngOnInit(): void {
    this.readValue();

    this.pluginService.addEventListener('configChanged', () => this.readValue()); // look for changes of talkback setting
  }

  /** Customize from here */
  /** updateConfig() will overwrite any settings that you'll provide */
  /** Don't try and 'append'/'push' to arrays this way - add a custom method instead */
  /** see config option to ignore devices as example */

  /** updateConfig() takes an optional second parameter to specify the accessoriy for which the setting is changed */

  @Input() device?: L_Device;
  value = false;

  talkbackIsEnabled = false;

  async readValue() {
    const config = this.getCameraConfig(this.device?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'rtsp')) {
      this.value = config['rtsp'];
    }

    if (config && Object.prototype.hasOwnProperty.call(config, 'talkback')) {
      this.talkbackIsEnabled = config['talkback'];
    }
  }

  update() {
    this.updateDeviceConfig(
      { rtsp: this.value, },
      this.device!,
    );
  }
}
