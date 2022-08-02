import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-enable-audio',
  templateUrl: './enable-audio.component.html',
})
export class EnableAudioComponent extends ConfigOptionsInterpreter implements OnInit {
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
  value = false;
  samplerate = 0;

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && config['videoConfig'] && Object.prototype.hasOwnProperty.call(config['videoConfig'], 'audio')) {
      this.value = config['videoConfig']['audio'];
    }
    if (config && config['videoConfig'] && Object.prototype.hasOwnProperty.call(config['videoConfig'], 'audioSampleRate')) {
      const sr = config['videoConfig']['audioSampleRate'];
      if (sr === 8 || sr === 16 || sr === 24) {
        this.samplerate = sr;
      }
    }
  }

  async update() {
    if (!this.accessory) {
      return;
    }

    let config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (!config) {
      config = {
        serialNumber: this.accessory?.uniqueId,
        videoConfig: {},
      };
    }

    if (!Object.prototype.hasOwnProperty.call(config, 'videoConfig')) {
      config['videoConfig'] = {};
    }
    config['videoConfig']['audio'] = this.value;
    config['videoConfig']['audioSampleRate'] = this.samplerate;

    this.updateConfig(config, this.accessory);
  }
}
