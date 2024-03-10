/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, OnInit, Input } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { NgbModal, ModalDismissReasons } from '@ng-bootstrap/ng-bootstrap';

import { faScrewdriverWrench } from '@fortawesome/free-solid-svg-icons';
import { faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { faRotate } from '@fortawesome/free-solid-svg-icons';

import { PluginService } from '../plugin.service';

import { L_Station } from '../util/types';
import { DeviceImage } from '../util/deviceToImagesMap';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { NgIf, NgFor } from '@angular/common';
import { NgbAccordionModule, NgbAlertModule } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-accessory-list',
  templateUrl: './accessory-list.component.html',
  styleUrls: ['./accessory-list.component.css'],
  standalone: true,
  imports: [
    RouterLink,
    NgIf,
    FaIconComponent,
    NgFor,
    NgbAccordionModule,
    NgbAlertModule,
  ],
  styles: `
  .accordion-button::before {
    flex-shrink: 0;
    width: var(--bs-accordion-btn-icon-width);
    height: var(--bs-accordion-btn-icon-width);
    margin-right: var(--bs-accordion-btn-icon-width);
    content: "";
    background-image: var(--bs-accordion-btn-active-icon);
    background-repeat: no-repeat;
    background-size: var(--bs-accordion-btn-icon-width);
    transition: var(--bs-accordion-btn-icon-transition);
  }
  .accordion-button:not(.collapsed)::before {
    background-image: var(--bs-accordion-btn-active-icon);
    transform: var(--bs-accordion-btn-icon-transform);
  }
  .accordion-button::after {
    display: none !important;
  }
  .serial {
    filter: blur(5px);
  }
  .serial:hover {
    filter: none;
  }
	`,
})
export class AccessoryListComponent implements OnInit {
  stations: L_Station[] = [];
  versionUnmatched: boolean = false;

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
  ) { }

  ngOnInit(): void {
    this.waitForAccessories = this.route.snapshot.paramMap.get('waitForAccessories') === 'true';

    window.homebridge.addEventListener('versionUnmatched', (event: any) => {
      console.log(`Stored version (${event.data['storedVersion']}) does not match current version (${event.data['currentVersion']})`);
      this.versionUnmatched = true;
    });

    this.pluginService.addEventListener('newAccessories', () => {
      console.log('plugin accessories have changed. updating...');
      this.updateStations();
    });

    this.updateStations();

    if (!this.waitForAccessories && this.stations.length === 0) {
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

  private async updateProperties() {
    const { ignoreStations = [], ignoreDevices = [] } = await this.pluginService.getConfig();

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
