import { Component, OnInit } from '@angular/core';
import 'rxjs';

@Component({
  selector: 'app-download-logs',
  templateUrl: './download-logs.component.html',
  styles: [
  ],
})
export class DownloadLogsComponent implements OnInit {

  ngOnInit(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.homebridge.addEventListener('compressingLogFile', (event: any) => {
      // eslint-disable-next-line no-console
      console.log(event);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = event['data'] as any;
      const filename = data['filename'] as string;
      this.updateDownloadMessage(`Compressing log file: ${event['filename']}...`);
    });
  }

  isDownloading = false;
  downloadMessage?: string;

  // TODO: add failure banner
  async downloadLogs() {
    try {
      this.isDownloading = true;
      const logBuffer = await window.homebridge.request('/downloadLogs') as Buffer;
      const blob = new Blob([logBuffer], { type: 'application/zip' });
      const url= window.URL.createObjectURL(blob);
      // window.open(url);
      window.location.href = url;
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
