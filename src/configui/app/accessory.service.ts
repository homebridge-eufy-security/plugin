import { Injectable } from '@angular/core';
import { ChargingStatus } from './util/eufy-security-client.utils';

@Injectable({
  providedIn: 'root',
})
export class AccessoryService {

  public async getChargingStatus(sn: string): Promise<ChargingStatus> {
    return window.homebridge.request('/getChargingStatus', sn);
  }

  public async setExperimentalRTSPStatus(sn: string, value: boolean): Promise<string> {
    return window.homebridge.request('/setExperimentalRTSP', { sn: sn, value: value});
  }
}
