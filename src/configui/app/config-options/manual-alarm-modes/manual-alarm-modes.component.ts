import { Component, Input, OnInit } from '@angular/core';
import { L_Station } from '../../util/types';
import { PluginService } from '../../plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
    selector: 'app-manual-alarm-modes',
    templateUrl: './manual-alarm-modes.component.html',
    styles: [],
    standalone: true,
})
export class ManualAlarmModesComponent extends ConfigOptionsInterpreter implements OnInit {

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

  @Input() station?: L_Station;
  value: number[] = [];

  async readValue() {
    const config = await this.getStationConfig(this.station?.uniqueId || '');

    if (config && Array.isArray(config['manualTriggerModes'])) {
      this.value = config['manualTriggerModes'];
    }
  }

  toggle(mode: number) {
    if (this.value.indexOf(mode) !== -1) {
      this.value = this.value.filter(v => v !== mode);
    } else {
      this.value.push(mode);
    }
  }

  update() {
    this.updateStationConfig(
      {
        manualTriggerModes: this.value,
      },
      this.station!,
    );
  }

}
