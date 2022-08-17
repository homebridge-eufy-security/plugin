import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../accessory';
import { AccessoryService } from '../../accessory.service';
import { PluginService } from '../../plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-experimental-rtsp',
  templateUrl: './experimental-rtsp.component.html',
  styles: [
  ],
})
export class ExperimentalRtspComponent extends ConfigOptionsInterpreter implements OnInit {

  constructor(
    pluginService: PluginService,
    private accessoryService: AccessoryService,
  ) {
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

  @Input() accessory?: Accessory;
  value = false;

  rtspSetting = false;

  rtspUrl?: string;
  error?: Error;

  state?: boolean;
  url?: string;

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'experimentalRTSP')) {
      this.value = config['experimentalRTSP'];
    }

    if (config && Object.prototype.hasOwnProperty.call(config, 'rtsp')) {
      this.rtspSetting = config['rtsp'];
    }

    if (this.accessory) {
      this.accessoryService.getExperimentalRTSPStatus(this.accessory.uniqueId)
        .then(result => {
          this.state = result.state;
          this.url = result.url;
        });
    }
  }

  update() {
    this.updateConfig(
      {
        experimentalRTSP: this.value,
      },
      this.accessory,
    );

    if (this.accessory) {
      this.accessoryService.setExperimentalRTSPStatus(this.accessory.uniqueId, this.value)
        .then(url => this.rtspUrl = url)
        .catch(err => this.error = err);
    }

  }

}
