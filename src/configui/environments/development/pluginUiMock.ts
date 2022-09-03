/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Buffer } from 'buffer';

import { CachedAccessory, PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface';

import { LoginResult, LoginFailReason } from '../../app/util/types';
import { Accessory } from '../../app/accessory';
import { DEFAULT_CACHED_ACCESSORIES, DEFAULT_PLUGIN_CONFIG, DEFAULT_STORED_ACCESSORIES, CAPTCHA_DATA } from './mockData';

const REASONABLE_RESPONSE_TIME = 0.5;

export class PluginUiMock extends EventTarget {
  private cachedAccessories = DEFAULT_CACHED_ACCESSORIES;
  private storedAccessories = DEFAULT_STORED_ACCESSORIES;
  private pluginConfig = DEFAULT_PLUGIN_CONFIG;

  private loginWillFailWithTFA = false;
  private loginWillFailWithCaptcha = false;
  private loginWillTimeout = false;

  private logFilesCannotBeDownloaded = false;

  constructor() {
    super();
  }

  public mimicFirstLogin() {
    this.cachedAccessories = [];
    this.storedAccessories = [];
    this.pluginConfig = {};
  }

  public mimicWillRequestTFA() {
    this.loginWillFailWithTFA = true;
  }

  public mimicWillRequestCaptcha() {
    this.loginWillFailWithCaptcha = true;
  }

  public mimicLoginWillTimeoutOnce() {
    this.loginWillTimeout = true;
  }

  public mimicPopulatedConfigWithoutAccessories() {
    this.cachedAccessories = [];
    this.storedAccessories = [];
    this.pluginConfig = DEFAULT_PLUGIN_CONFIG;
  }

  public mimicAlreadyPopulatedConfigAndAccessories() {
    this.cachedAccessories = DEFAULT_CACHED_ACCESSORIES;
    this.storedAccessories = DEFAULT_STORED_ACCESSORIES;
    this.pluginConfig = DEFAULT_PLUGIN_CONFIG;
  }

  public mimicDownloadLogsFailure() {
    this.logFilesCannotBeDownloaded = true;
  }

  public getPluginConfig(): Promise<PluginConfig[]> {
    return Promise.resolve([this.pluginConfig]);
  }

  public updatePluginConfig(config: PluginConfig[]): Promise<PluginConfig[]> {
    console.log('update platform config');
    console.log(JSON.stringify(config));
    return Promise.resolve(config);
  }

  public savePluginConfig() {
    console.log('config has been saved');
  }

  public getCachedAccessories(): Promise<CachedAccessory[]> {
    return Promise.resolve(this.cachedAccessories);
  }

  public request(path: string, body?: any): Promise<any> {
    switch (path) {
      case '/login':
        return this.login(body);
      case '/storedAccessories':
        return this.getStoredAccessories();
      case '/reset':
        return this.resetAll();
      case '/downloadLogs':
        return this.downloadLogs();
      default:
        return Promise.reject('unknown path');
    }
  }

  public closeSettings() {
    console.log('settings closed');
  }

  private login(options: any): Promise<LoginResult> {
    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        resolve({
          success: false,
          failReason: LoginFailReason.TIMEOUT,
        });
      }, 25000);

      setTimeout(() => {
        if (this.loginWillFailWithTFA) {
          this.loginWillFailWithTFA = false;
          resolve({
            success: false,
            failReason: LoginFailReason.TFA,
          });
          return;
        }

        if (this.loginWillFailWithCaptcha) {
          this.loginWillFailWithCaptcha = false;
          resolve({
            success: false,
            failReason: LoginFailReason.CAPTCHA,
            data: {
              id: '1',
              captcha: CAPTCHA_DATA,
            },
          });
          return;
        }

        if (this.loginWillTimeout) {
          this.loginWillTimeout = false;
          return;
        }

        this.cachedAccessories = DEFAULT_CACHED_ACCESSORIES;
        setTimeout(() => {
          this.pushAllAccessories(DEFAULT_CACHED_ACCESSORIES);
          this.storedAccessories = DEFAULT_STORED_ACCESSORIES;
        }, 2000);

        resolve({
          success: true,
        });
      }, REASONABLE_RESPONSE_TIME * 1000);
    });
  }

  private getStoredAccessories(): Promise<Accessory[]> {
    return Promise.resolve(this.storedAccessories);
  }

  private pushAllAccessories(accessories: CachedAccessory[]) {
    setTimeout(() => {
      const newAccessories = accessories;
      const accessory = newAccessories.shift();
      if (!accessory) {
        return;
      }

      this.pushAccessory({
        uniqueId: accessory.context['device'].uniqueId,
        displayName: accessory.context['device'].displayName,
        type: accessory.context['device'].type,
        station: accessory.context['device'].station,
      });
      this.pushAllAccessories(newAccessories);
    }, REASONABLE_RESPONSE_TIME * 1000);
  }

  private pushAccessory(accessory: Accessory) {
    this.dispatchEvent(new DataEvent('addAccessory', accessory));
  }

  private resetAll() {
    this.mimicFirstLogin();
    return Promise.resolve({ result: 1 });
  }

  private downloadLogs(): Promise<{type: string; data: Buffer }> {

    this.dispatchEvent(new DataEvent('downloadLogsFileCount', { numberOfFiles: 2 }));

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (this.logFilesCannotBeDownloaded) {
          reject('Severe failure while log files would have been downloaded');
        } else {
          const file = 'many many log entries as zip file';
          const buffer = Buffer.from(file);
          resolve({ type: 'Buffer', data: buffer });
        }
      }, 4000);
    });
  }
}

class DataEvent extends Event {
  data?: any;

  constructor(type: string, data: any) {
    super(type);
    this.data = data;
  }
}
