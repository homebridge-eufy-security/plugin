import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { PluginService } from '../plugin.service';

@Component({
  selector: 'app-reset-confirmation',
  templateUrl: './reset-confirmation.component.html',
  styles: [
  ],
})
export class ResetConfirmationComponent {

  disabled = false;
  failed = false;

  constructor(
    private routerService: Router,
    private pluginService: PluginService,
  ) { }

  cancel() {
    this.routerService.navigateByUrl('/accessories');
  }

  async resetEverything() {
    this.disabled = true;
    try {
      const r = await window.homebridge.request('/reset');
      this.failed = (r.result !== 1);
    } catch (err) {
      this.failed = true;
    }
    this.disabled = false;

    if (!this.failed) {
      await this.pluginService.updateConfig({}, true);
      window.homebridge.closeSettings();
    }
  }
}
