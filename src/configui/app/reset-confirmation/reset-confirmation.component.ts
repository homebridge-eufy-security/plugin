import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { PluginService } from '../plugin.service';
import { NgbAlert } from '@ng-bootstrap/ng-bootstrap';
import { NgIf } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-reset-confirmation',
  templateUrl: './reset-confirmation.component.html',
  styles: [],
  standalone: true,
  imports: [
    NgIf,
    NgbAlert,
    LucideAngularModule,
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
    } catch (error) {
      console.error(error);
      this.failed = true;
    }
    this.disabled = false;

    if (!this.failed) {
      await this.pluginService.resetConfig();
      window.homebridge.closeSettings();
    }
  }
}
