/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, NgZone, OnInit } from '@angular/core';
import { Router, NavigationStart } from '@angular/router';

@Component({
  selector: 'app-download-logs',
  templateUrl: './download-logs.component.html',
  styles: [
  ],
})
export class DownloadLogsComponent implements OnInit {

  private routeSub: any;

  constructor(
    private router: Router,
    private zone: NgZone,
  ) { }

  ngOnInit(): void {

    this.routeSub = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        if (this.logFileLocation !== '') {
          // eslint-disable-next-line no-console
          console.log('revoke log zip file blob location url.');
          window.URL.revokeObjectURL(this.logFileLocation);
          this.logFileLocation = '';
        }
      }
    })

    window.homebridge.addEventListener('downloadLogsFileCount', (event: any) => {
      const data = event['data'] as any;
      const numberOfFiles = data['numberOfFiles'] as number;
      this.updateDownloadMessage(`Compressing ${numberOfFiles} log files...`);
    });

    window.homebridge.addEventListener('downloadLogsComplete', (event: any) => {
      this.updateDownloadMessage('Log files were compressed successfully. Click \'Download\' to get your file.');
    });
  }

  failed = false;
  isDownloading = false;
  hasDownloaded = false;
  downloadMessage?: string;
  failureMessage = '';
  logFileLocation = '';

  async downloadLogs() {
    try {
      this.isDownloading = true;
      const fileBuffer = await window.homebridge.request('/downloadLogs') as Buffer;

      const blob = new Blob([fileBuffer], { type: 'application/zip' });
      const url= window.URL.createObjectURL(blob);
      
      this.logFileLocation = url;
      
      this.hasDownloaded = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(err);

      const error = err as { message: string };
      this.failed = true;
      this.updateDownloadMessage(undefined);
      this.failureMessage = `Generating of compressed logs.zip file did not complete: ${error.message}`;
    } finally {
      this.isDownloading = false;
    }
  }

  private updateDownloadMessage(message?: string) {
    this.zone.run(() => {
      this.downloadMessage = message;
    });
  }

}
