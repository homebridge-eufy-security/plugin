import { importProvidersFrom } from '@angular/core';
import { AppComponent } from './app/app.component';
import { AppRoutingModule } from './app/app-routing.module';
import { getIconsModule } from './app/icon.module';
import { FormsModule } from '@angular/forms';
import { BrowserModule, bootstrapApplication } from '@angular/platform-browser';
import { LocationStrategy, HashLocationStrategy } from '@angular/common';

bootstrapApplication(AppComponent, {
  providers: [
    importProvidersFrom(
      BrowserModule, FormsModule, AppRoutingModule, getIconsModule()),
    { provide: LocationStrategy, useClass: HashLocationStrategy }
  ]
})
  .catch(error => console.error(error));
