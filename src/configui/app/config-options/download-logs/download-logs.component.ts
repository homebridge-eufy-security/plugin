import { Component, OnInit } from '@angular/core';

import { fromEvent } from 'rxjs';

@Component({
  selector: 'app-download-logs',
  templateUrl: './download-logs.component.html',
  styles: [
  ],
})
export class DownloadLogsComponent implements OnInit {

  private numberOfFilesEvent$ = fromEvent(window.homebridge, 'downloadLogsFileCount');

  // TODO: remove lint warnings
  ngOnInit(): void {
    // window.homebridge.addEventListener('downloadLogsFileCount', (event: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.numberOfFilesEvent$.subscribe((event: any) => {
      // eslint-disable-next-line no-console
      console.log(event);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = event['data'] as any;
      const numberOfFiles = data['numberOfFiles'] as number;
      this.updateDownloadMessage(`Compressing ${numberOfFiles} log files...`);
    });
  }

  isDownloading = false;
  hasDownloaded = false;
  downloadMessage?: string;
  logFileLocation = '';

  // TODO: add failure banner
  async downloadLogs() {
    try {
      this.isDownloading = true;
      const location = await window.homebridge.request('/downloadLogs') as string;
      
      this.logFileLocation = location;
      
      this.hasDownloaded = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(err);
    } finally {
      this.isDownloading = false;
    }
  }

  private updateDownloadMessage(message?: string) {
    this.downloadMessage = message;
  }

}
