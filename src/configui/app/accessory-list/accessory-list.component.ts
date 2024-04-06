/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, OnInit, Input } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { NgbModal, ModalDismissReasons } from '@ng-bootstrap/ng-bootstrap';

import { faScrewdriverWrench, faEyeSlash, faRotate, faVideo, faShieldHalved, faDownload } from '@fortawesome/free-solid-svg-icons';

import { PluginService } from '../plugin.service';

import { L_Station } from '../util/types';
import { DeviceImage } from '../util/deviceToImagesMap';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
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
    FaIconComponent,
    NgFor,
    NgbAccordionModule,
    NgbAlertModule,
    NgbTooltipModule,
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
  .my-custom-header::after {
    content: none;
  }
  .accordion-button2 {
    position: relative;
    cursor: pointer;
    display: flex;
    align-items: center;
    width: 100%;
    padding: var(--bs-accordion-btn-padding-y) var(--bs-accordion-btn-padding-x);
    font-size: 1rem;
    color: var(--bs-accordion-btn-color);
    text-align: left;
    background-color: var(--bs-accordion-btn-bg);
    border: 0;
    border-radius: 0;
    overflow-anchor: none;
    transition: var(--bs-accordion-transition);
  }
  .accordion-button2::before {
    flex-shrink: 0;
    width: var(--bs-accordion-btn-icon-width);
    height: var(--bs-accordion-btn-icon-width);
    margin-right: var(--bs-accordion-btn-icon-width);
    content: "";
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='currentColor' class='bi bi-box-arrow-up-right' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' d='M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5'/%3E%3Cpath fill-rule='evenodd' d='M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-size: var(--bs-accordion-btn-icon-width);
    transition: var(--bs-accordion-btn-icon-transition);
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
  videoIcon = faVideo;
  shieldIcon = faShieldHalved;
  downloadIcon = faDownload;

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
      }).catch(() => {
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
