import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';
import { DEFAULT_CONFIG_VALUES } from '../../util/default-config-values';

@Component({
  selector: 'app-embedded-pkcs1-support',
  templateUrl: './embedded-pkcs1-support.component.html',
  standalone: true,
  imports: [FormsModule],
})
export class EmbeddedPKCS1SupportComponent extends ConfigOptionsInterpreter implements OnInit {

  enableEmbeddedPKCS1Support = DEFAULT_CONFIG_VALUES.enableEmbeddedPKCS1Support;

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
    this.enableEmbeddedPKCS1Support = this.config['enableEmbeddedPKCS1Support'] ?? this.enableEmbeddedPKCS1Support;
  }

  update() {
    this.updateConfig({
      enableEmbeddedPKCS1Support: this.enableEmbeddedPKCS1Support,
    });
  }
}
