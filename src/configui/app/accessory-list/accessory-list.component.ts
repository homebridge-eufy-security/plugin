/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, OnInit, Input, NgZone, ChangeDetectionStrategy, ChangeDetectorRef, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgbModal, ModalDismissReasons } from '@ng-bootstrap/ng-bootstrap';
import { PluginService } from '../plugin.service';
import { L_Station } from '../util/types';
import { DeviceImage } from '../util/deviceToImagesMap';
import { NgIf, NgFor, AsyncPipe, NgSwitch, NgSwitchCase, NgTemplateOutlet } from '@angular/common';
import { NgbAlertModule, NgbTooltipModule } from '@ng-bootstrap/ng-bootstrap';
import { LucideAngularModule } from 'lucide-angular';
import { BehaviorSubject, Observable } from 'rxjs';

@Component({
  selector: 'app-accessory-list',
  templateUrl: './accessory-list.component.html',
  standalone: true,
  imports: [
    RouterLink,
    NgIf,
    NgFor,
    NgSwitch,
    NgSwitchCase,
    NgTemplateOutlet,
    LucideAngularModule,
    NgbAlertModule,
    NgbTooltipModule,
    AsyncPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class AccessoryListComponent implements OnInit {
  private stationsSubject = new BehaviorSubject<L_Station[]>([]);
  stations$: Observable<L_Station[]> = this.stationsSubject.asObservable();

  versionUnmatched = false;
  adminAccountUsed = false;

  @Input() waitForAccessories?: boolean;

  DeviceImage = DeviceImage;
  closeResult = '';

  constructor(
    private modalService: NgbModal,
    public pluginService: PluginService,
    private route: ActivatedRoute,
    private router: Router,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.waitForAccessories = this.route.snapshot.paramMap.get('waitForAccessories') === 'true';

    this.setupEventListeners();

    this.updateStations();

    if (!this.waitForAccessories && this.stationsSubject.getValue().length === 0) {
      this.loadStoredAccessories();
    }

    this.stations$.subscribe(stations => {
      console.log('Stations updated:', stations);
    });

  }

  private setupEventListeners(): void {
    window.homebridge.addEventListener('versionUnmatched', this.handleVersionUnmatched.bind(this));
    this.pluginService.addEventListener('newAccessories', this.handleNewAccessories.bind(this));
    window.homebridge.addEventListener('addAccessory', this.handleAddAccessory.bind(this));
    window.homebridge.addEventListener('AdminAccountUsed', this.handleAdminAccountUsed.bind(this));
  }

  private handleVersionUnmatched(event: any): void {
    console.log(`Stored version (${event.data['storedVersion']}) does not match current version (${event.data['currentVersion']})`);
    this.versionUnmatched = true;
    this.cdr.markForCheck();
  }

  private async handleNewAccessories(): Promise<void> {
    await this.zone.run(() => this.updateStations());
  }

  private async handleAddAccessory(): Promise<void> {
    await this.zone.run(() => this.updateStations());
  }

  private async handleAdminAccountUsed(): Promise<void> {
    console.log('Admin account used');
    this.adminAccountUsed = true;
    this.stationsSubject.next([]);
    await this.pluginService.resetConfig();
    this.cdr.markForCheck();
  }

  private async updateStations(): Promise<void> {
    const stations = this.pluginService.getStations();

    if (stations.every(station => !station.devices || station.devices.length === 0)) {
      console.log('No stations with devices populated. Skipping update.');
      return;
    }


    const { ignoreStations = [], ignoreDevices = [] } = this.pluginService.getConfig();

    stations.forEach((station) => {
      station.ignored = ignoreStations.includes(station.uniqueId);
      station.devices?.forEach((device) => {
        device.ignored = ignoreDevices.includes(device.uniqueId);
      });
    });

    if (stations === this.stationsSubject.getValue()) {
      console.log('Nothing to update. Skipping update.');
      return;
    }

    this.stationsSubject.next(stations);
    this.cdr.markForCheck();
  }

  openReloadModal(content: any): void {
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

  private loadStoredAccessories(): void {
    this.pluginService.loadStoredAccessories().then((result) => {
      if (!result) {
        this.router.navigateByUrl('/login');
      }
    }).catch(() => {
      this.router.navigateByUrl('/login');
    });
  }

  trackByStationId(index: number, station: L_Station): string {
    return station.uniqueId;
  }

  trackByDeviceId(index: number, device: any): string {
    return device.uniqueId;
  }
}