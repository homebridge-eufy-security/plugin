import { Component, OnInit } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

import 'rxjs';

@Component({
  selector: 'app-download-logs',
  templateUrl: './download-logs.component.html',
  styles: [
  ],
})
export class DownloadLogsComponent implements OnInit {

  constructor(private sanitizer: DomSanitizer) { }

  // TODO: remove lint warnings
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
  hasDownloaded = false;
  downloadMessage?: string;
  dataUrl = '';

  // TODO: add failure banner
  async downloadLogs() {
    try {
      this.isDownloading = true;
      const logBuffer = await window.homebridge.request('/downloadLogs') as Buffer;
      this.dataUrl = this.generateDataUrl(logBuffer);
      this.hasDownloaded = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(err);
    } finally {
      this.isDownloading = false;
    }
  }

  sanitize(url:string){
    return this.sanitizer.bypassSecurityTrustUrl(url);
  }

  private generateDataUrl(buffer: Buffer): string {
    let url = 'data:application/zip;base64,';
    url += buffer.toString('base64');
    return url;
  }

  private updateDownloadMessage(message?: string) {
    this.downloadMessage = message;
  }

}
