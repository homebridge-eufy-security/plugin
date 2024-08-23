/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@angular/core';
import { PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface';

import { PluginService } from './plugin.service';
import { Credentials, LoginResult } from './util/types';

@Injectable({
  providedIn: 'root',
})
export class LoginService {
  constructor(private pluginService: PluginService) { }

  public getCredentials(): Credentials {
    const config = this.pluginService.getConfig();

    if (!config['username'] || !config['password']) {
      throw new Error('no full credentials in config');
    }

    return {
      username: config['username'],
      password: config['password'],
      country: config['country'] ? config['country'] : 'US',
      deviceName: config['deviceName'],
    };
  }

  public async login(options: any): Promise<LoginResult> {
    try {
      const result = await window.homebridge.request('/login', options);
      return Promise.resolve(result as LoginResult);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  public async updateConfigCredentials(credentials: Credentials) {
    let config: PluginConfig = {};

    try {
      config = this.pluginService.getConfig();
    } catch (error) {
      console.log('Could not get credentials from config: ', error);
    }

    config['username'] = credentials.username;
    config['password'] = credentials.password;
    config['country'] = credentials.country;
    config['deviceName'] = credentials.deviceName;

    await this.pluginService.updateConfig(config);
    await this.pluginService.saveConfig();
  }
}
