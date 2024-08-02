import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NgIf } from '@angular/common';
import { NgbCollapse, NgbProgressbar } from '@ng-bootstrap/ng-bootstrap';
import { DownloadLogsComponent } from '../download-logs/download-logs.component';
import { LucideAngularModule } from 'lucide-angular';
import { ResetPluginComponent } from '../reset-plugin/reset-plugin.component';
import { EnableDetailedLoggingComponent } from '../enable-detailed-logging/enable-detailed-logging.component';

@Component({
  selector: 'app-github-issue',
  templateUrl: './github-issue.component.html',
  styles: [],
  standalone: true,
  imports: [
    RouterLink,
    NgIf,
    NgbProgressbar,
    NgbCollapse,
    LucideAngularModule,
    DownloadLogsComponent,
    ResetPluginComponent,
    EnableDetailedLoggingComponent,
  ],
})
export class GithubIssueComponent {

  isCollapsed: boolean = true;

}
