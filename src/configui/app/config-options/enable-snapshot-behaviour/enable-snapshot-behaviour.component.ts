import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

@Component({
  selector: 'app-enable-snapshot-behaviour',
  templateUrl: './enable-snapshot-behaviour.component.html',
})
export class EnableSnapshotBehaviourComponent extends ConfigOptionsInterpreter implements OnInit {
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
  @Output() showEvent = new EventEmitter<boolean>();
  value = true;

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'useEnhancedSnapshotBehaviour')) {
      this.value = config['useEnhancedSnapshotBehaviour'];
      this.updateParent();
    }
  }

  update() {
    this.updateConfig(
      {
        useEnhancedSnapshotBehaviour: this.value,
      },
      this.accessory,
    );
    this.updateParent();
  }

  private updateParent() {
    this.showEvent.emit(this.value);
  }
}
