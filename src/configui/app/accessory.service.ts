import { Injectable } from '@angular/core';
import { ChargingStatus } from './util/eufy-security-client.utils';

@Injectable({
  providedIn: 'root',
})
export class AccessoryService {

  public async getChargingStatus(sn: string): Promise<ChargingStatus> {
    try {
      const response = await window.homebridge.request('/getChargingStatus', sn);
      return Promise.resolve(response);
    } catch (err) {
      return Promise.reject(err);
    }
  }
}
