import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PluginService } from '../../plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';
import { DEFAULT_CONFIG_VALUES } from '../../util/default-config-values';

@Component({
  selector: 'app-embedded-pkcs1-support',
  templateUrl: './embedded-pkcs1-support.component.html',
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class EmbeddedPKCS1SupportComponent extends ConfigOptionsInterpreter implements OnInit {

  enableEmbeddedPKCS1Support = DEFAULT_CONFIG_VALUES.enableEmbeddedPKCS1Support;
  nodeVersion: string = '';
  opensslVersion: string = '';
  nativePKCS1Support: boolean = false;

  constructor(pluginService: PluginService) {
    super(pluginService);
  }
  
  async ngOnInit(): Promise<void> {
    this.readValue();
    await this.detectNodeVersions();
  }
  
  private async detectNodeVersions(): Promise<void> {
    try {
      // Get Node.js and OpenSSL versions and PKCS1 support status from the server
      const versionInfo = await this.pluginService.getNodeVersions();
      this.nodeVersion = versionInfo.node || 'Unknown';
      this.opensslVersion = versionInfo.openssl || 'Unknown';
      this.nativePKCS1Support = versionInfo.nativePKCS1Support || false;
    } catch (error) {
      console.warn('Could not detect Node.js versions:', error);
    }
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
