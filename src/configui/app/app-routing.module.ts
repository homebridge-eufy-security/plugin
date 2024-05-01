import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AccessoryListComponent } from './accessory-list/accessory-list.component';
import { AdvancedConfigOptionsComponent } from './advanced-config-options/advanced-config-options.component';
import { AccessoryConfigOptionsComponent } from './accessory-config-options/accessory-config-options.component';
import { LoginComponent } from './login/login.component';
import { ResetConfirmationComponent } from './reset-confirmation/reset-confirmation.component';
import { DownloadLogsComponent } from './config-options/download-logs/download-logs.component';

const routes: Routes = [
  { path: '', redirectTo: '/accessories', pathMatch: 'full' },
  { path: 'accessories', component: AccessoryListComponent },
  { path: 'advancedConfig', component: AdvancedConfigOptionsComponent },
  { path: 'downloadLogs', component: DownloadLogsComponent },
  { path: 'config/:type/:id', component: AccessoryConfigOptionsComponent },
  { path: 'login', component: LoginComponent },
  { path: 'reset', component: ResetConfirmationComponent },
  { path: '**', redirectTo: '/accessories' },
];

@NgModule({
  declarations: [],
  imports: [RouterModule.forRoot(routes, {
    scrollPositionRestoration: 'enabled',
  })],
  exports: [RouterModule],
})
export class AppRoutingModule { }