import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-livestream-duration-seconds',
  templateUrl: './livestream-duration-seconds.component.html',
  standalone: true,
  imports: [FormsModule],
})
export class LivestreamDurationSecondsComponent extends ConfigOptionsInterpreter implements OnInit {
  constructor(pluginService: PluginService) {
    super(pluginService);
  }

  async ngOnInit(): Promise<void> {
    this.readValue();
  }

  /** Customize from here */
  /** updateConfig() will overwrite any settings that you'll provide */
  /** Don't try and 'append'/'push' to arrays this way - add a custom method instead */
  /** see config option to ignore devices as example */

  /** updateConfig() takes an optional second parameter to specify the accessoriy for which the setting is changed */

  CameraMaxLivestreamDuration = 30;
  inputIsInvalid = false;

  readValue() {
      this.CameraMaxLivestreamDuration = this.config['CameraMaxLivestreamDuration'] ?? this.CameraMaxLivestreamDuration;
  }

  update() {
    this.inputIsInvalid = false;
    if (!this.CameraMaxLivestreamDuration || this.CameraMaxLivestreamDuration < 0) {
      this.inputIsInvalid = true;
    }

    if (!this.inputIsInvalid) {
      this.updateConfig({
        CameraMaxLivestreamDuration: this.CameraMaxLivestreamDuration,
      });
    }
  }
}
