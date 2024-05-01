/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, OnInit, Input } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { NgbModal, ModalDismissReasons } from '@ng-bootstrap/ng-bootstrap';

import { FeatherModule } from 'angular-feather';
import { PluginService } from '../plugin.service';

import { L_Station } from '../util/types';
import { DeviceImage } from '../util/deviceToImagesMap';
import { NgIf, NgFor } from '@angular/common';
import { NgbAccordionModule, NgbAlertModule, NgbTooltipModule } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-accessory-list',
  templateUrl: './accessory-list.component.html',
  styleUrls: ['./accessory-list.component.css'],
  standalone: true,
  imports: [
    RouterLink,
    NgIf,
    FeatherModule,
    NgFor,
    NgbAccordionModule,
    NgbAlertModule,
    NgbTooltipModule,
  ],
})
export class AccessoryListComponent implements OnInit {
  stations: L_Station[] = [];
  versionUnmatched: boolean = false;

  @Input() waitForAccessories?: boolean;

  DeviceImage = DeviceImage;

  closeResult = '';

  constructor(
    private modalService: NgbModal,
    public pluginService: PluginService,
    private route: ActivatedRoute,
    private routerService: Router,
  ) { }

  async ngOnInit(): Promise<void> {
    this.waitForAccessories = this.route.snapshot.paramMap.get('waitForAccessories') === 'true';

    window.homebridge.addEventListener('versionUnmatched', (event: any) => {
      console.log(`Stored version (${event.data['storedVersion']}) does not match current version (${event.data['currentVersion']})`);
      this.versionUnmatched = true;
    });

    this.pluginService.addEventListener('newAccessories', async () => {
      console.log('plugin accessories have changed. updating...');
      await this.updateStations();
    });

    await this.updateStations();

    if (!this.waitForAccessories && this.stations.length === 0) {
      this.pluginService.loadStoredAccessories().then((result) => {
        if (!result) {
          this.routerService.navigateByUrl('/login');
        }
      }).catch(() => {
        this.routerService.navigateByUrl('/login');
      });
    }
  }

  private async updateStations() {
    const { ignoreStations = [], ignoreDevices = [] } = await this.pluginService.getConfig();
    this.stations = this.pluginService.getStations() ?? [];

    this.stations.forEach((station) => {
      station.ignored = ignoreStations.includes(station.uniqueId);
      station.devices?.forEach((device) => {
        device.ignored = ignoreDevices.includes(device.uniqueId);
      });
    });
  }

  openReloadModal(content: any) {
    this.modalService.open(content, { ariaLabelledBy: 'modal-basic-title', centered: true }).result.then(
      (result) => {
        this.closeResult = `Closed with: ${result}`;
      },
      (reason) => {
        this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
      },
    );
  }

  private getDismissReason(reason: any): string {
    if (reason === ModalDismissReasons.ESC) {
      return 'by pressing ESC';
    } else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
      return 'by clicking on a backdrop';
    } else {
      return `with: ${reason}`;
    }
  }

}
