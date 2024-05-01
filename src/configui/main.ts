/* eslint-disable no-console */
import { importProvidersFrom } from '@angular/core';
import { AppComponent } from './app/app.component';
import { AppRoutingModule } from './app/app-routing.module';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { FormsModule } from '@angular/forms';
import { BrowserModule, bootstrapApplication } from '@angular/platform-browser';
import { LocationStrategy, HashLocationStrategy } from '@angular/common';
import { allIcons } from "angular-feather/icons";
import { FeatherModule } from 'angular-feather';

bootstrapApplication(AppComponent, {
  providers: [
    importProvidersFrom(BrowserModule, FormsModule, NgbModule, AppRoutingModule, FeatherModule.pick(allIcons)),
    { provide: LocationStrategy, useClass: HashLocationStrategy }
  ]
})
  .catch(err => console.error(err));
