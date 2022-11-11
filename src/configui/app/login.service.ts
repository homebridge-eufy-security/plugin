/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@angular/core';
import { PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface';

import { PluginService } from './plugin.service';
import { Credentials, LoginResult, LoginFailReason } from './util/types';

@Injectable({
  providedIn: 'root',
})
export class LoginService {
  constructor(private pluginService: PluginService) {}

  public async getCredentials(): Promise<Credentials> {
    try {
      const config = await this.pluginService.getConfig();

      if (!config['username'] || !config['password']) {
        return Promise.reject('no full credentials in config');
      }

      return Promise.resolve({
        username: config['username'],
        password: config['password'],
        country: config['country'] ? config['country'] : 'US',
        deviceName: config['deviceName'],
      });
    } catch (err) {
      return Promise.reject('no config');
    }
  }

  public async login(options: any): Promise<LoginResult> {
    try {
      const result = await window.homebridge.request('/login', options);
      return Promise.resolve(result as LoginResult);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  public async updateConfigCredentials(credentials: Credentials) {
    let config: PluginConfig = {};

    try {
      config = await this.pluginService.getConfig();
    } catch (err) {
      console.log('Could not get credentials from config: ' + err);
    }

    config['username'] = credentials.username;
    config['password'] = credentials.password;
    config['country'] = credentials.country;
    config['deviceName'] = credentials.deviceName;

    await this.pluginService.updateConfig(config, true);
  }
}
