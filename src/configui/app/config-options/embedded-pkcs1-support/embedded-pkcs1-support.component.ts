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
      // Get Node.js and OpenSSL versions from the server
      const versions = await this.pluginService.getNodeVersions();
      this.nodeVersion = versions.node || 'Unknown';
      this.opensslVersion = versions.openssl || 'Unknown';
      this.nativePKCS1Support = this.hasNativePKCS1Support(versions.node, versions.openssl);
    } catch (error) {
      console.warn('Could not detect Node.js versions:', error);
    }
  }
  
  private hasNativePKCS1Support(nodeVersion: string, opensslVersion: string): boolean {
    if (!nodeVersion || !opensslVersion) {
      return false;
    }
    
    // Parse Node.js version
    const nodeVersionMatch = nodeVersion.match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (!nodeVersionMatch) {
      return false;
    }
    
    const nodeMajor = parseInt(nodeVersionMatch[1], 10);
    const nodeMinor = parseInt(nodeVersionMatch[2], 10);
    const nodePatch = parseInt(nodeVersionMatch[3], 10);
    
    // Parse OpenSSL version
    const opensslVersionMatch = opensslVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!opensslVersionMatch) {
      return false;
    }
    
    const opensslMajor = parseInt(opensslVersionMatch[1], 10);
    const opensslMinor = parseInt(opensslVersionMatch[2], 10);
    const opensslPatch = parseInt(opensslVersionMatch[3], 10);
    
    // Node.js 24.9.0+ with OpenSSL 3.5.2+ has restored PKCS1 support
    if (nodeMajor >= 25) {
      return true;
    }
    
    if (nodeMajor === 24 && nodeMinor >= 9) {
      // Check if OpenSSL is 3.5.2+
      if (opensslMajor > 3) {
        return true;
      }
      if (opensslMajor === 3 && opensslMinor > 5) {
        return true;
      }
      if (opensslMajor === 3 && opensslMinor === 5 && opensslPatch >= 2) {
        return true;
      }
    }
    
    // Versions before the PKCS1 removal had native support
    if (nodeMajor < 18) {
      return true;
    }
    
    if (nodeMajor === 18 && nodeMinor < 19) {
      return true;
    }
    
    if (nodeMajor === 18 && nodeMinor === 19 && nodePatch < 1) {
      return true;
    }
    
    if (nodeMajor === 20 && nodeMinor < 11) {
      return true;
    }
    
    if (nodeMajor === 20 && nodeMinor === 11 && nodePatch < 1) {
      return true;
    }
    
    if (nodeMajor === 21 && nodeMinor < 6) {
      return true;
    }
    
    if (nodeMajor === 21 && nodeMinor === 6 && nodePatch < 2) {
      return true;
    }
    
    return false;
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
