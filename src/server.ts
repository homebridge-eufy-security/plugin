import { EufySecurity, EufySecurityConfig } from 'eufy-security-client';
import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import fs from 'fs';
import { Accessory } from './configui/app/accessory';

// TODO: add logging mechanism
// TODO: add strict typing

class UiServer extends HomebridgePluginUiServer {
  storagePath: string;
  storedAccessories_file: string;
  accessories: Accessory[] = [];

  config: EufySecurityConfig;
  eufyClient: EufySecurity | null;

  constructor() {
    super();

    this.storagePath = this.homebridgeStoragePath + '/eufysecurity';
    this.storedAccessories_file = this.storagePath + '/accessories.json';

    this.eufyClient = null;

    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath);
    }

    this.config = {
      username: '',
      password: '',
      language: 'en',
      persistentDir: this.storagePath,
      p2pConnectionSetup: 0,
      pollingIntervalMinutes: 10,
      eventDurationSeconds: 10,
      acceptInvitations: true,
    };

    this.onRequest('/login', this.login.bind(this));
    this.onRequest('/storedAccessories', this.loadStoredAccessories.bind(this));

    this.ready();
  }

  async login(options) {
    console.log('login method entry');
    console.log(JSON.stringify(options));

    if (!this.eufyClient && options && options.username && options.password && options.country) {
      this.accessories = []; // clear accessories array so that it can be filled with all devices after login
      console.log('init eufyClient');
      this.config.username = options.username;
      this.config.password = options.password;
      this.config.country = options.country;
      try {
        this.eufyClient = await EufySecurity.initialize(this.config);
      } catch (err) {
        console.log(err);
      }
      this.eufyClient?.on('station added', this.addStation.bind(this));
      this.eufyClient?.on('device added', this.addDevice.bind(this));
    }

    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        resolve({
          success: false,
          failReason: 3, // timeout
        });
      }, 25000);

      if (options && options.username && options.password && options.country) {
        // login with credentials
        console.log('login with credentials');
        try {
          this.loginHandlers(resolve);
          this.eufyClient?.connect()
            .then(() => {
              console.log('connected?: ' + this.eufyClient?.isConnected());
            })
            .catch((err) => console.log(err));
          console.log('connect method called');
        } catch (err) {
          console.log('Error!');
          console.log(err);
          resolve({
            success: false,
            failReason: 0,
            data: {
              error: err,
            },
          });
        }
      } else if (options && options.verifyCode) {
        // login with tfa code
        try {
          this.loginHandlers(resolve);
          this.eufyClient?.connect({
            verifyCode: options.verifyCode,
            force: false,
          });
        } catch (err) {
          resolve({
            success: false,
            failReason: 0,
            data: {
              error: err,
            },
          });
        }
      } else if (options && options.captcha) {
        // login witch captcha
        try {
          this.loginHandlers(resolve);
          this.eufyClient?.connect({
            captcha: {
              captchaCode: options.captcha.captchaCode,
              captchaId: options.captcha.captchaId,
            },
            force: false,
          });
        } catch (err) {
          resolve({
            success: false,
            failReason: 0,
            data: {
              error: err,
            },
          });
        }
      } else {
        reject('unsupported login method');
      }
    });
  }

  async loadStoredAccessories() {
    try {
      const accessories = JSON.parse(fs.readFileSync(this.storedAccessories_file, { encoding: 'utf-8' }));
      return Promise.resolve(accessories);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  loginHandlers(resolveCallback) {
    console.log('loginHandlers');
    this.eufyClient?.once('tfa request', () => {
      console.log('tfa request');
      resolveCallback({
        success: false,
        failReason: 2, // TFA
      });
    });

    this.eufyClient?.once('captcha request', (id, captcha) => {
      console.log('captcha request');
      resolveCallback({
        success: false,
        failReason: 1, // Captcha
        data: {
          id: id,
          captcha: captcha,
        },
      });
    });

    this.eufyClient?.once('connect', () => {
      console.log('connect');
      resolveCallback({
        success: true,
      });
    });
  }

  addStation(station) {
    const s = {
      uniqueId: station.getSerial(),
      displayName: station.getName(),
      station: true,
      type: station.getDeviceType(),
    };
    this.accessories.push(s);
    this.storeAccessories();
    this.pushEvent('addAccessory', s);
  }

  addDevice(device) {
    const d = {
      uniqueId: device.getSerial(),
      displayName: device.getName(),
      station: false,
      type: device.getDeviceType(),
    };
    this.accessories.push(d);
    this.storeAccessories();
    this.pushEvent('addAccessory', d);
  }

  storeAccessories() {
    fs.writeFileSync(this.storedAccessories_file, JSON.stringify(this.accessories));
  }
}

// start the instance of the class
(() => {
  return new UiServer();
})();
