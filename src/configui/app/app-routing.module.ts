import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AccessoryListComponent } from './accessory-list/accessory-list.component';
import { AdvancedConfigOptionsComponent } from './advanced-config-options/advanced-config-options.component';
import { CameraConfigOptionsComponent } from './camera-config-options/camera-config-options.component';
import { LoginComponent } from './login/login.component';
import { StationConfigOptionsComponent } from './station-config-options/station-config-options.component';
import { ResetConfirmationComponent } from './reset-confirmation/reset-confirmation.component';

const routes: Routes = [
  { path: '', redirectTo: '/accessories', pathMatch: 'full' },
  { path: 'accessories', component: AccessoryListComponent },
  { path: 'advancedConfig', component: AdvancedConfigOptionsComponent },
  { path: 'cameraConfig/:uniqueId', component: CameraConfigOptionsComponent },
  { path: 'stationConfig/:uniqueId', component: StationConfigOptionsComponent },
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
export class AppRoutingModule {}