import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AccessoryListComponent } from './accessory-list/accessory-list.component';
import { LoginComponent } from './login/login.component';
import { AdvancedConfigOptionsComponent } from './advanced-config-options/advanced-config-options.component';
import { EnableDetailedLoggingComponent } from './config-options/enable-detailed-logging/enable-detailed-logging.component';
import { PollingIntervalMinutesComponent } from './config-options/polling-interval-minutes/polling-interval-minutes.component';
import { LivestreamDurationSecondsComponent } from './config-options/livestream-duration-seconds/livestream-duration-seconds.component';
import { EditCredentialsComponent } from './config-options/edit-credentials/edit-credentials.component';
import { CleanCacheComponent } from './config-options/clean-cache/clean-cache.component';
import { CameraConfigOptionsComponent } from './camera-config-options/camera-config-options.component';
import { IgnoreAccessoryComponent } from './config-options/ignore-accessory/ignore-accessory.component';
import { EnableCameraComponent } from './config-options/enable-camera/enable-camera.component';
import { CameraButtonsComponent } from './config-options/camera-buttons/camera-buttons.component';
import { UnbridgeAccessoryComponent } from './config-options/unbridge-accessory/unbridge-accessory.component';
import { LivestreamCacheComponent } from './config-options/livestream-cache/livestream-cache.component';
import { RtspStreamingComponent } from './config-options/rtsp-streaming/rtsp-streaming.component';
import { EnableAudioComponent } from './config-options/enable-audio/enable-audio.component';
import { EnableSnapshotBehaviourComponent } from './config-options/enable-snapshot-behaviour/enable-snapshot-behaviour.component';
import { ForceRefreshsnapComponent } from './config-options/force-refreshsnap/force-refreshsnap.component';
import { SnapshotHandlingMethodComponent } from './config-options/snapshot-handling-method/snapshot-handling-method.component';
import {
  ImmediateNotificationOnRingComponent,
} from './config-options/immediate-notification-on-ring/immediate-notification-on-ring.component';
import { DelayCameraSnapshotsComponent } from './config-options/delay-camera-snapshots/delay-camera-snapshots.component';
import { PeriodicSnapshotRefreshComponent } from './config-options/periodic-snapshot-refresh/periodic-snapshot-refresh.component';
import { AdvancedVideoconfigComponent } from './config-options/advanced-videoconfig/advanced-videoconfig.component';

import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { StationConfigOptionsComponent } from './station-config-options/station-config-options.component';
import { GuardModesMappingComponent } from './config-options/guard-modes-mapping/guard-modes-mapping.component';

@NgModule({
  declarations: [
    AppComponent,
    AccessoryListComponent,
    LoginComponent,
    AdvancedConfigOptionsComponent,
    EnableDetailedLoggingComponent,
    PollingIntervalMinutesComponent,
    LivestreamDurationSecondsComponent,
    EditCredentialsComponent,
    CleanCacheComponent,
    CameraConfigOptionsComponent,
    IgnoreAccessoryComponent,
    EnableCameraComponent,
    CameraButtonsComponent,
    UnbridgeAccessoryComponent,
    LivestreamCacheComponent,
    RtspStreamingComponent,
    EnableAudioComponent,
    EnableSnapshotBehaviourComponent,
    ForceRefreshsnapComponent,
    SnapshotHandlingMethodComponent,
    ImmediateNotificationOnRingComponent,
    DelayCameraSnapshotsComponent,
    PeriodicSnapshotRefreshComponent,
    AdvancedVideoconfigComponent,
    StationConfigOptionsComponent,
    GuardModesMappingComponent,
  ],
  imports: [BrowserModule, FormsModule, NgbModule, AppRoutingModule, FontAwesomeModule],
  providers: [{ provide: LocationStrategy, useClass: HashLocationStrategy }],
  bootstrap: [AppComponent],
})
export class AppModule {}
