import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class AccessoryService {

  public async getChargingStatus(sn: string): Promise<boolean> {
    try {
      const response = await window.homebridge.request('/getChargingStatus', sn);
      console.log(response);
      // TODO: add implementation
      return Promise.resolve(true);
    } catch (err) {
      return Promise.reject(err);
    }
  }
}
