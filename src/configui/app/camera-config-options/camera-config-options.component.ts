import { Component, OnInit, Input } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { L_Device } from '../util/types';
import { ConfigOptionsInterpreter } from '../config-options/config-options-interpreter';
import { PluginService } from '../plugin.service';
import { AdvancedVideoconfigComponent } from '../config-options/advanced-videoconfig/advanced-videoconfig.component';
import { ForceRefreshsnapComponent } from '../config-options/force-refreshsnap/force-refreshsnap.component';
import { PeriodicSnapshotRefreshComponent } from '../config-options/periodic-snapshot-refresh/periodic-snapshot-refresh.component';
import { DelayCameraSnapshotsComponent } from '../config-options/delay-camera-snapshots/delay-camera-snapshots.component';
import { ImmediateNotificationOnRingComponent } from '../config-options/immediate-notification-on-ring/immediate-notification-on-ring.component';
import { SnapshotHandlingMethodComponent } from '../config-options/snapshot-handling-method/snapshot-handling-method.component';
import { EnableHsvComponent } from '../config-options/enable-hsv/enable-hsv.component';
import { CameraButtonsComponent } from '../config-options/camera-buttons/camera-buttons.component';
import { TalkbackComponent } from '../config-options/talkback/talkback.component';
import { EnableAudioComponent } from '../config-options/enable-audio/enable-audio.component';
import { RtspStreamingComponent } from '../config-options/rtsp-streaming/rtsp-streaming.component';
import { EnableCameraComponent } from '../config-options/enable-camera/enable-camera.component';
import { IgnoreAccessoryComponent } from '../config-options/ignore-accessory/ignore-accessory.component';
import { NgIf } from '@angular/common';
import { NgbAccordionModule } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-camera-config-options',
  templateUrl: './camera-config-options.component.html',
  standalone: true,
  imports: [
    RouterLink,
    NgIf,
    IgnoreAccessoryComponent,
    EnableCameraComponent,
    RtspStreamingComponent,
    EnableAudioComponent,
    TalkbackComponent,
    CameraButtonsComponent,
    EnableHsvComponent,
    SnapshotHandlingMethodComponent,
    ImmediateNotificationOnRingComponent,
    DelayCameraSnapshotsComponent,
    PeriodicSnapshotRefreshComponent,
    ForceRefreshsnapComponent,
    AdvancedVideoconfigComponent,
    NgbAccordionModule,
  ],
})
export class CameraConfigOptionsComponent extends ConfigOptionsInterpreter implements OnInit {
  device?: L_Device;

  showEnhancedSnapshotBehaviour = true;
  isDoorbell = false;
  isCamera = false;
  supportsRTSP = false;
  supportsTalkback = false;

  constructor(pluginService: PluginService, private route: ActivatedRoute) {
    super(pluginService);
  }

  ngOnInit(): void {
    const uniqueId = this.route.snapshot.paramMap.get('uniqueId');
    this.device = this.pluginService.getDevice(uniqueId);

    if (this.device) {
      this.isCamera = this.device.isCamera!;
      this.isDoorbell = this.device.isDoorbell!;
      this.supportsRTSP = this.device.supportsRTSP!;
      this.supportsTalkback = this.device.supportsTalkback!;

      // reset rtsp and talkback setting if these are not supported
      if (!this.supportsRTSP) {
        this.updateDeviceConfig(
          {
            rtsp: false,
          },
          this.device,
        );
      }

      if (!this.supportsTalkback) {
        this.updateDeviceConfig(
          {
            talkback: false,
          },
          this.device,
        );
      }
    }
  }

  updateSnapshotView(value: boolean) {
    this.showEnhancedSnapshotBehaviour = value;
  }
}
