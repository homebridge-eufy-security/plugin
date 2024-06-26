/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, OnInit, Input, NgZone } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { NgbModal, ModalDismissReasons, NgbProgressbar } from '@ng-bootstrap/ng-bootstrap';

import { PluginService } from '../plugin.service';

import { L_Station } from '../util/types';
import { DeviceImage } from '../util/deviceToImagesMap';
import { NgIf, NgFor } from '@angular/common';
import { NgbAccordionModule, NgbAlertModule, NgbTooltipModule } from '@ng-bootstrap/ng-bootstrap';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-accessory-list',
  templateUrl: './accessory-list.component.html',
  styleUrls: ['./accessory-list.component.css'],
  standalone: true,
  imports: [
    RouterLink,
    NgIf,
    LucideAngularModule,
    NgFor,
    NgbAccordionModule,
    NgbAlertModule,
    NgbTooltipModule,
    NgbProgressbar,
  ],
})
export class AccessoryListComponent implements OnInit {
  stations: L_Station[] = [];
  versionUnmatched: boolean = false;

  adminAccountUsed: boolean = false;

  progress: number = 0;
  wait_timer: number = 200;

  @Input() waitForAccessories?: boolean;

  DeviceImage = DeviceImage;

  closeResult = '';

  constructor(
    private modalService: NgbModal,
    public pluginService: PluginService,
    private route: ActivatedRoute,
    private routerService: Router,
    private zone: NgZone,
  ) { }

  async ngOnInit(): Promise<void> {
    this.waitForAccessories = this.route.snapshot.paramMap.get('waitForAccessories') === 'true';

    window.homebridge.addEventListener('versionUnmatched', (event: any) => {
      console.log(`Stored version (${event.data['storedVersion']}) does not match current version (${event.data['currentVersion']})`);
      this.versionUnmatched = true;
    });

    this.pluginService.addEventListener('newAccessories', async () => {
      await this.zone.run(async () => {
        await this.updateStations();
      });
    });

    window.homebridge.addEventListener('addAccessory', async () => {
      await this.zone.run(async () => {
        await this.updateStations();
      });
    });

    window.homebridge.addEventListener('AdminAccountUsed', async () => {
      this.adminAccountUsed = true;
      this.stations = [];
    });

    this.update_progress(10);
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

    const stations = this.pluginService.getStations();

    // Check if there are no stations with devices populated
    if (stations.every(station => !station.devices || station.devices.length === 0)) {
      console.log('No stations with devices populated. Skipping update.');
      this.update_progress(20);
      return;
    }

    this.update_progress(40);
    const { ignoreStations = [], ignoreDevices = [] } = this.pluginService.getConfig();

    this.update_progress(50);
    stations.forEach((station) => {
      station.ignored = ignoreStations.includes(station.uniqueId);
      station.devices?.forEach((device) => {
        device.ignored = ignoreDevices.includes(device.uniqueId);
      });
    });

    this.update_progress(70);

    if (stations === this.stations) {
      console.log('Nothing to update. Skipping update.');
      return;
    }

    this.update_progress(90);
    this.stations = stations;

  }

  private update_progress(progress: number): void {
    this.progress = progress;
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
