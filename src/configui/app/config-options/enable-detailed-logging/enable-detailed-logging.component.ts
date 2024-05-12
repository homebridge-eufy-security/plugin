import { Component, OnInit } from '@angular/core';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';
import { FormsModule } from '@angular/forms';
import { DEFAULT_CONFIG_VALUES } from '../../util/default-config-values';

@Component({
  selector: 'app-enable-detailed-logging',
  templateUrl: './enable-detailed-logging.component.html',
  standalone: true,
  imports: [FormsModule],
})
export class EnableDetailedLoggingComponent extends ConfigOptionsInterpreter implements OnInit {

  enableDetailedLogging = DEFAULT_CONFIG_VALUES.enableDetailedLogging;

  constructor(pluginService: PluginService) {
    super(pluginService);
  }

  async ngOnInit(): Promise<void> {
    this.readValue();
  }

  readValue() {
    this.enableDetailedLogging = this.config['enableDetailedLogging'] ?? this.enableDetailedLogging;
  }

  update() {
    this.updateConfig({
      enableDetailedLogging: this.enableDetailedLogging,
    });
  }
}
