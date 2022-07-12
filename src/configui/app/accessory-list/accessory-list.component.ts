/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, OnInit, Input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { NgbModal, ModalDismissReasons } from '@ng-bootstrap/ng-bootstrap';

import { faScrewdriverWrench } from '@fortawesome/free-solid-svg-icons';
import { faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { faRotate } from '@fortawesome/free-solid-svg-icons';

import { PluginService } from '../plugin.service';

import { Accessory } from '../accessory';
import { DeviceImage } from '../util/deviceToImagesMap';

@Component({
  selector: 'app-accessory-list',
  templateUrl: './accessory-list.component.html',
  styleUrls: ['./accessory-list.component.css'],
})
export class AccessoryListComponent implements OnInit {
  stations: Accessory[] = [];
  devices: Accessory[] = [];

  @Input() waitForAccessories?: boolean;

  settingsIcon = faScrewdriverWrench;
  ignoreIcon = faEyeSlash;
  reloadIcon = faRotate;

  DeviceImage = DeviceImage;

  closeResult = '';

  constructor(
    private modalService: NgbModal,
    public pluginService: PluginService,
    private route: ActivatedRoute,
    private routerService: Router,
  ) {}

  ngOnInit(): void {
    this.waitForAccessories = this.route.snapshot.paramMap.get('waitForAccessories') === 'true';

    this.pluginService.addEventListener('newAccessories', () => {
      console.log('plugin accessories have changed. updating...');
      this.updateDevices();
      this.updateStations();
    });

    this.updateStations();
    this.updateDevices();

    if (!this.waitForAccessories && this.stations.length === 0 && this.devices.length === 0) {
      this.pluginService.loadStoredAccessories().then((result) => {
        if (!result) {
          this.routerService.navigateByUrl('/login');
        }
      }).catch(err => {
        this.routerService.navigateByUrl('/login');
      });
    }
  }

  private updateStations() {
    this.stations = this.pluginService.getStations();
    this.updateProperties();
  }

  private updateDevices() {
    this.devices = this.pluginService.getDevices();
    this.updateProperties();
  }

  private async updateProperties() {
    const config = await this.pluginService.getConfig();

    if (Array.isArray(config['ignoreStations'])) {
      this.stations.forEach((station) => {
        station.ignored = config['ignoreStations'].find((uId: string) => uId === station.uniqueId) !== undefined;
      });
    }

    if (Array.isArray(config['ignoreDevices'])) {
      this.devices.forEach((device) => {
        device.ignored = config['ignoreDevices'].find((uId: string) => uId === device.uniqueId) !== undefined;
      });
    }

    // load cached Names
    this.stations.forEach((station) => {
      this.pluginService.getCachedName(station).then((cachedName) => (station.cachedName = cachedName));
    });
    this.devices.forEach((device) => {
      this.pluginService.getCachedName(device).then((cachedName) => (device.cachedName = cachedName));
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

  getDevicePanelStyle(accessory: Accessory): string {
    let style = '';
    if (accessory.ignored) {
      style += 'opacity: 0.2;';
    }
    if (DeviceImage.get(accessory.type)) {
      style += 'padding:' + DeviceImage.get(accessory.type)?.padding;
    } else {
      style += 'padding:20px';
    }
    return style;
  }
}
