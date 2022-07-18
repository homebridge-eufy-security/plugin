import { Component, OnInit, Input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { Accessory } from '../accessory';
import { PluginService } from '../plugin.service';
import { Device } from '../util/eufy-security-client.utils';

@Component({
  selector: 'app-camera-config-options',
  templateUrl: './camera-config-options.component.html',
})
export class CameraConfigOptionsComponent implements OnInit {
  accessory?: Accessory;

  showEnhancedSnapshotBehaviour = true;
  isDoorbell = false;
  isCamera = false;
  supportsRTSP = false;

  constructor(private pluginService: PluginService, private route: ActivatedRoute) { }

  ngOnInit(): void {
    const uniqueId = this.route.snapshot.paramMap.get('uniqueId');
    this.accessory = this.pluginService.getDevice(uniqueId);

    if (this.accessory) {
      this.isDoorbell = Device.isDoorbell(this.accessory.type);
      this.isCamera = Device.isCamera(this.accessory.type);
      this.supportsRTSP = Device.supportsRTSP(this.accessory.type);
    }
  }

  updateSnapshotView(value: boolean) {
    this.showEnhancedSnapshotBehaviour = value;
  }
}
