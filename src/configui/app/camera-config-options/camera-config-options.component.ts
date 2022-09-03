import { Component, OnInit, Input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { Accessory } from '../accessory';
import { ConfigOptionsInterpreter } from '../config-options/config-options-interpreter';
import { PluginService } from '../plugin.service';
import { Device } from '../util/eufy-security-client.utils';

@Component({
  selector: 'app-camera-config-options',
  templateUrl: './camera-config-options.component.html',
})
export class CameraConfigOptionsComponent extends ConfigOptionsInterpreter implements OnInit {
  accessory?: Accessory;

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
    this.accessory = this.pluginService.getDevice(uniqueId);

    if (this.accessory) {
      this.isDoorbell = Device.isDoorbell(this.accessory.type);
      this.isCamera = Device.isCamera(this.accessory.type);
      this.supportsRTSP = Device.supportsRTSP(this.accessory.type);
      this.supportsTalkback = Device.supportsTalkback(this.accessory.type);

      // reset rtsp and talkback setting if these are not supported
      if (!this.supportsRTSP) {
        this.updateConfig(
          {
            rtsp: false,
          },
          this.accessory,
        );
      }

      if (!this.supportsTalkback) {
        this.updateConfig(
          {
            talkback: false,
          },
          this.accessory,
        );
      }
    }
  }

  updateSnapshotView(value: boolean) {
    this.showEnhancedSnapshotBehaviour = value;
  }
}
