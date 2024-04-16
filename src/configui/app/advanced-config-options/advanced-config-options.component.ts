import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ResetPluginComponent } from '../config-options/reset-plugin/reset-plugin.component';
import { DownloadLogsComponent } from '../config-options/download-logs/download-logs.component';
import { GuardModesMappingComponent } from '../config-options/guard-modes-mapping/guard-modes-mapping.component';
import { CleanCacheComponent } from '../config-options/clean-cache/clean-cache.component';
import { OmitLogFilesComponent } from '../config-options/omit-log-files/omit-log-files.component';
import { IgnoreMultipleDevicesWarningComponent } from '../config-options/ignore-multiple-devices-warning/ignore-multiple-devices-warning.component';
import { EnableDetailedLoggingComponent } from '../config-options/enable-detailed-logging/enable-detailed-logging.component';
import { LivestreamDurationSecondsComponent } from '../config-options/livestream-duration-seconds/livestream-duration-seconds.component';
import { PollingIntervalMinutesComponent } from '../config-options/polling-interval-minutes/polling-interval-minutes.component';
import { EditCredentialsComponent } from '../config-options/edit-credentials/edit-credentials.component';
import { AutoSyncStationComponent } from '../config-options/auto-sync-station/auto-sync-station.component';
import { NodejsSecurityComponent } from '../config-options/nodejs-security/nodejs-security.component';

@Component({
    selector: 'app-advanced-config-options',
    templateUrl: './advanced-config-options.component.html',
    standalone: true,
    imports: [
        RouterLink,
        EditCredentialsComponent,
        PollingIntervalMinutesComponent,
        LivestreamDurationSecondsComponent,
        EnableDetailedLoggingComponent,
        IgnoreMultipleDevicesWarningComponent,
        OmitLogFilesComponent,
        CleanCacheComponent,
        GuardModesMappingComponent,
        DownloadLogsComponent,
        ResetPluginComponent,
        AutoSyncStationComponent,
        NodejsSecurityComponent,
    ],
})
export class AdvancedConfigOptionsComponent {

}
