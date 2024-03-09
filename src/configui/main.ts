/* eslint-disable no-console */
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';


import { importProvidersFrom } from '@angular/core';
import { AppComponent } from './app/app.component';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { AppRoutingModule } from './app/app-routing.module';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { FormsModule } from '@angular/forms';
import { BrowserModule, bootstrapApplication } from '@angular/platform-browser';
import { LocationStrategy, HashLocationStrategy } from '@angular/common';

bootstrapApplication(AppComponent, {
    providers: [
        importProvidersFrom(BrowserModule, FormsModule, NgbModule, AppRoutingModule, FontAwesomeModule),
        { provide: LocationStrategy, useClass: HashLocationStrategy }
    ]
})
    .catch(err => console.error(err));
