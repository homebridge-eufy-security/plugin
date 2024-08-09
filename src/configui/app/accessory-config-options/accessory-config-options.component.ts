import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { L_Device, L_Station } from '../util/types';
import { ConfigOptionsInterpreter } from '../config-options/config-options-interpreter';
import { PluginService } from '../plugin.service';
import { AdvancedVideoconfigComponent } from '../config-options/advanced-videoconfig/advanced-videoconfig.component';
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
import { NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { NgbAccordionModule } from '@ng-bootstrap/ng-bootstrap';
import { GuardModesMappingComponent } from '../config-options/guard-modes-mapping/guard-modes-mapping.component';
import { ManualAlarmModesComponent } from '../config-options/manual-alarm-modes/manual-alarm-modes.component';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-accessory-config-options',
  templateUrl: './accessory-config-options.component.html',
  standalone: true,
  imports: [
    RouterLink,
    NgIf,
    NgSwitch,
    NgSwitchCase,
    NgSwitchDefault,
    LucideAngularModule,
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
    AdvancedVideoconfigComponent,
    GuardModesMappingComponent,
    ManualAlarmModesComponent,
    NgbAccordionModule,
  ],
})
export class AccessoryConfigOptionsComponent extends ConfigOptionsInterpreter implements OnInit {
  station?: L_Station;
  device?: L_Device;

  uniqueId: string = '';
  type: string = '';

  isDoorbell: boolean = false;
  isCamera: boolean = false;
  enableCamera: boolean = true;
  supportsRTSP: boolean = false;
  supportsTalkback: boolean = false;

  constructor(pluginService: PluginService, private route: ActivatedRoute) {
    super(pluginService);
  }

  ngOnInit(): void {

    this.route.params.subscribe(params => {
      this.uniqueId = params['id'];
      this.type = params['type'];
    });

    switch (this.type) {
      case 'both':
        this.station = this.pluginService.getStation(this.uniqueId);
        this.device = this.pluginService.getDevice(this.uniqueId);
        break;
      case 'station':
        this.station = this.pluginService.getStation(this.uniqueId);
        break;
      case 'device':
        this.device = this.pluginService.getDevice(this.uniqueId);
        break;
    }

    if (this.station && this.station.disabled) {
      this.station.ignored = true;
    }

    if (this.device) {
      this.checkDeviceConfig();

      this.isCamera = this.device.isCamera ?? this.isCamera;
      this.isDoorbell = this.device.isDoorbell ?? this.isDoorbell;
      this.supportsRTSP = this.device.supportsRTSP ?? this.supportsRTSP;
      this.supportsTalkback = this.device.supportsTalkback ?? this.supportsTalkback;

      // reset rtsp and talkback setting if these are not supported
      if (!this.supportsRTSP) {
        this.updateDeviceConfig(
          { rtsp: false },
          this.device,
        );
      }

      if (!this.supportsTalkback) {
        this.updateDeviceConfig(
          { talkback: false },
          this.device,
        );
      }
    }
  }

  ignoredStationChanged(state: boolean) {
    this.station!.ignored = state;
  }

  checkDeviceConfig() {
    const config = this.getCameraConfig(this.device?.uniqueId || '');
    if (config && Object.prototype.hasOwnProperty.call(config, 'enableCamera')) {
      this.enableCamera = config['enableCamera'];
    }
  }

  ignoredDeviceChanged(state: boolean) {
    this.device!.ignored = state;
  }
}
