import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { L_Station } from '../util/types';
import { PluginService } from '../plugin.service';
import { ManualAlarmModesComponent } from '../config-options/manual-alarm-modes/manual-alarm-modes.component';
import { GuardModesMappingComponent } from '../config-options/guard-modes-mapping/guard-modes-mapping.component';
import { IgnoreAccessoryComponent } from '../config-options/ignore-accessory/ignore-accessory.component';
import { NgIf } from '@angular/common';

@Component({
    selector: 'app-station-config-options',
    templateUrl: './station-config-options.component.html',
    styles: [],
    standalone: true,
    imports: [
        RouterLink,
        NgIf,
        IgnoreAccessoryComponent,
        GuardModesMappingComponent,
        ManualAlarmModesComponent,
    ],
})
export class StationConfigOptionsComponent implements OnInit {
  station?: L_Station;

  constructor(private pluginService: PluginService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    const uniqueId = this.route.snapshot.paramMap.get('uniqueId');
    this.station = this.pluginService.getStation(uniqueId);
  }
}
