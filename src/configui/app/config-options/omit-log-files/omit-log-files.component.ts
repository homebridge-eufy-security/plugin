import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';
import { DEFAULT_CONFIG_VALUES } from '../../util/default-config-values';

@Component({
  selector: 'app-omit-log-files',
  templateUrl: './omit-log-files.component.html',
  styles: [],
  standalone: true,
  imports: [FormsModule],
})
export class OmitLogFilesComponent extends ConfigOptionsInterpreter implements OnInit {

  omitLogFiles = DEFAULT_CONFIG_VALUES.omitLogFiles;

  constructor(pluginService: PluginService) {
    super(pluginService);
  }

  async ngOnInit(): Promise<void> {
    this.readValue();
  }

  /** Customize from here */
  /** updateConfig() will overwrite any settings that you'll provide */
  /** Don't try and 'append'/'push' to arrays this way - add a custom method instead */
  /** see config option to ignore devices as example */

  /** updateConfig() takes an optional second parameter to specify the accessoriy for which the setting is changed */

  readValue() {
    this.omitLogFiles = this.config['omitLogFiles'] ?? this.omitLogFiles;
  }

  update() {
    this.updateConfig({
      omitLogFiles: this.omitLogFiles,
    });
  }

}
