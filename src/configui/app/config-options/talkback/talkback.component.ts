import { Component, Input, OnInit } from '@angular/core';
import { L_Device } from '../../util/types';
import { PluginService } from '../../plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-talkback',
    templateUrl: './talkback.component.html',
    styles: [],
    standalone: true,
    imports: [FormsModule, NgIf],
})
export class TalkbackComponent extends ConfigOptionsInterpreter implements OnInit {

  constructor(pluginService: PluginService) {
    super(pluginService);
  }

  ngOnInit(): void {
    this.readValue();

    this.pluginService.addEventListener('configChanged', () => this.readValue()); // look for changes of rtsp setting
  }

  /** Customize from here */
  /** updateConfig() will overwrite any settings that you'll provide */
  /** Don't try and 'append'/'push' to arrays this way - add a custom method instead */
  /** see config option to ignore devices as example */

  /** updateConfig() takes an optional second parameter to specify the accessoriy for which the setting is changed */

  @Input() device?: L_Device;
  value = false;

  rtspIsEnabled = false;

  async readValue() {
    const config = this.getCameraConfig(this.device?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'talkback')) {
      this.value = config['talkback'];
    }

    if (config && Object.prototype.hasOwnProperty.call(config, 'rtsp')) {
      this.rtspIsEnabled = config['rtsp'];
    }
  }

  update() {
    this.updateDeviceConfig(
      {
        talkback: this.value,
      },
      this.device!,
    );
  }

}
