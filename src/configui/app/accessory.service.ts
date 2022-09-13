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

  public async getExperimentalRTSPStatus(sn: string): Promise<{ state: boolean; url?: string }> {
    return window.homebridge.request('/getExperimentalRTSPStatus', sn);
  }

  public async getStationsDevicesMapping(): Promise<unknown> {
    return window.homebridge.request('/getStationDeviceMapping');
  }

  public async getDevicesOnSameStation(sn: string): Promise<string[]> {
    
    try {
      const mapping = await this.getStationsDevicesMapping() as object;
      for (const devices of Object.values(mapping)) {
        if (Array.isArray(devices) && devices.indexOf(sn) > -1) {
          return Promise.resolve(devices as string[]);
        }
      }

      // sn was not found in mapping
      throw new Error('no valid station - devices mapping was found');
    } catch (err) {
      return Promise.reject(err);
    }
  }
}
