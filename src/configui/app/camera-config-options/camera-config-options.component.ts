import { Component, OnInit, Input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { Accessory } from '../util/types';
import { ConfigOptionsInterpreter } from '../config-options/config-options-interpreter';
import { PluginService } from '../plugin.service';

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
      this.isCamera = this.accessory.isCamera!;
      this.isDoorbell = this.accessory.isDoorbell!;
      this.supportsRTSP = this.accessory.supportsRTSP!;
      this.supportsTalkback = this.accessory.supportsTalkback!;

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
