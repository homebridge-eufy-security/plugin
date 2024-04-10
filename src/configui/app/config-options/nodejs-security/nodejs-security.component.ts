import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-nodejs-security',
  templateUrl: './nodejs-security.component.html',
  standalone: true,
  imports: [FormsModule],
})
export class NodejsSecurityComponent extends ConfigOptionsInterpreter implements OnInit {
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

  model = false;

  readValue() {
    if (Object.prototype.hasOwnProperty.call(this.config, 'nodejs_security')) {
      this.model = this.config['nodejs_security'];
    }
  }

  update() {
    this.updateConfig({
      nodejs_security: this.model,
    });
  }
}
