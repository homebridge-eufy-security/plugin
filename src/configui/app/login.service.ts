/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@angular/core';
import { PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface';

import { PluginService } from './plugin.service';

export type Credentials = {
  username: string;
  password: string;
  country: string;
};

export enum LoginFailReason {
  UNKNOWN = 0,
  CAPTCHA = 1,
  TFA = 2,
  TIMEOUT = 3,
}

export type LoginResult = {
  success: boolean;
  failReason?: LoginFailReason;
  data?: any;
};

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

    await this.pluginService.updateConfig(config, true);
  }
}
