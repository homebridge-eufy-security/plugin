/* eslint-disable no-console */
import { importProvidersFrom } from '@angular/core';
import { AppComponent } from './app/app.component';
import { AppRoutingModule } from './app/app-routing.module';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { FormsModule } from '@angular/forms';
import { BrowserModule, bootstrapApplication } from '@angular/platform-browser';
import { LocationStrategy, HashLocationStrategy } from '@angular/common';
import {
  LucideAngularModule, SlidersHorizontal, RefreshCw, Download, Bug, Video, VideoOff, Shield,
  ShieldOff, Eye, EyeOff, ChevronLeft, Square, SquarePlus, SquareMinus,
  TriangleAlert, Info, MessageSquareWarning
} from 'lucide-angular';

bootstrapApplication(AppComponent, {
  providers: [
    importProvidersFrom(
      BrowserModule, FormsModule, NgbModule, AppRoutingModule,
      LucideAngularModule.pick({
        SlidersHorizontal, RefreshCw, Download, Bug, Video, VideoOff, Shield,
        ShieldOff, Eye, EyeOff, ChevronLeft, Square, SquarePlus, SquareMinus,
        TriangleAlert, Info, MessageSquareWarning
      })),
    { provide: LocationStrategy, useClass: HashLocationStrategy }
  ]
})
  .catch(err => console.error(err));
