/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, NgZone, OnInit } from '@angular/core';

@Component({
  selector: 'app-download-logs',
  templateUrl: './download-logs.component.html',
  styles: [
  ],
})
export class DownloadLogsComponent implements OnInit {

  // private numberOfFilesEvent$ = fromEvent(window.homebridge, 'downloadLogsFileCount');

  constructor(private zone: NgZone) { }

  ngOnInit(): void {

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
      const location = await window.homebridge.request('/downloadLogs') as string;
      
      this.logFileLocation = location;
      
      this.hasDownloaded = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(err);

      this.failed = true;
      this.updateDownloadMessage(undefined);
      this.failureMessage = `Generating of compressed logs.zip file did not complete: ${err}`;
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
