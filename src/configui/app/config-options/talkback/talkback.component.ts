import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../accessory';
import { PluginService } from '../../plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../util/default-config-values';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-talkback',
  templateUrl: './talkback.component.html',
  styles: [
  ],
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

  @Input() accessory?: Accessory;
  value = DEFAULT_CAMERACONFIG_VALUES.talkback;
  talkbackChannels = DEFAULT_CAMERACONFIG_VALUES.talkbackChannels;

  rtspIsEnabled = false;

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'talkback')) {
      this.value = config['talkback'];
    }

    if (config && Object.prototype.hasOwnProperty.call(config, 'talkbackChannels')) {
      this.talkbackChannels = config['talkbackChannels'];
    }

    if (config && Object.prototype.hasOwnProperty.call(config, 'rtsp')) {
      this.rtspIsEnabled = config['rtsp'];
    }
  }

  update() {
    this.updateConfig(
      {
        talkback: this.value,
        talkbackChannels: this.talkbackChannels,
      },
      this.accessory,
    );
  }

}
