import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Accessory } from '../accessory';
import { PluginService } from '../plugin.service';

@Component({
  selector: 'app-station-config-options',
  templateUrl: './station-config-options.component.html',
  styles: [],
})
export class StationConfigOptionsComponent implements OnInit {
  accessory?: Accessory;

  constructor(private pluginService: PluginService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    const uniqueId = this.route.snapshot.paramMap.get('uniqueId');
    this.accessory = this.pluginService.getStation(uniqueId);
  }
}
