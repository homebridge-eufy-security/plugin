/* eslint-disable @typescript-eslint/no-var-requires */
import { EufySecurity, EufySecurityConfig, libVersion, Device, Station } from 'eufy-security-client';
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';

import fs from 'fs';
import path from 'path';
import { Logger as TsLogger } from 'tslog';
import { createStream } from 'rotating-file-stream';
import { Zip } from 'zip-lib';

import { Accessory } from './configui/app/accessory';
import { LoginResult, LoginFailReason } from './configui/app/util/types';

class UiServer extends HomebridgePluginUiServer {
  storagePath: string;
  storedAccessories_file: string;
  accessories: Accessory[] = [];

  config: EufySecurityConfig;
  eufyClient: EufySecurity | null;

  private log;
  private tsLog;

  private logZipFilePath: string;

  constructor() {
    super();

    this.storagePath = this.homebridgeStoragePath + '/eufysecurity';
    this.storedAccessories_file = this.storagePath + '/accessories.json';
    this.logZipFilePath = this.storagePath + '/logs.zip';

    this.eufyClient = null;

    const plugin = require('../package.json');

    const mainLogObj = {
      // eslint-disable-next-line max-len
      prettyLogTemplate: `[{{mm}}/{{dd}}/{{yyyy}} {{hh}}:{{MM}}:{{ss}}]\t[EufySecurity-${plugin.version}]\t{{logLevelName}}\t[{{fileNameWithLine}}{{name}}]\t`,
      prettyErrorTemplate: '\n{{errorName}} {{errorMessage}}\nerror stack:\n{{errorStack}}',
      prettyErrorStackTemplate: '  • {{fileName}}\t{{method}}\n\t{{fileNameWithLine}}',
      prettyErrorParentNamesSeparator: ':',
      prettyErrorLoggerNameDelimiter: '\t',
      stylePrettyLogs: true,
      minLevel: 2,
      // prettyLogTimeZone: 'UTC',
      prettyLogStyles: {
        logLevelName: {
          '*': ['bold', 'black', 'bgWhiteBright', 'dim'],
          SILLY: ['bold', 'white'],
          TRACE: ['bold', 'whiteBright'],
          DEBUG: ['bold', 'green'],
          INFO: ['bold', 'blue'],
          WARN: ['bold', 'yellow'],
          ERROR: ['bold', 'red'],
          FATAL: ['bold', 'redBright'],
        },
        dateIsoStr: 'white',
        filePathWithLine: 'white',
        name: ['white', 'bold'],
        nameWithDelimiterPrefix: ['white', 'bold'],
        nameWithDelimiterSuffix: ['white', 'bold'],
        errorName: ['bold', 'bgRedBright', 'whiteBright'],
        fileName: ['yellow'],
      },
    };

    this.log = new TsLogger(mainLogObj);
    this.tsLog = new TsLogger({ type: 'hidden', minLevel: 2 });

    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath);
    }

    const pluginLogStream = createStream('configui-server.log', {
      path: this.storagePath,
      interval: '1d',
      rotate: 3,
      maxSize: '200M',
    });

    const pluginLogLibStream = createStream('configui-lib.log', {
      path: this.storagePath,
      interval: '1d',
      rotate: 3,
      maxSize: '200M',
    });

    this.log.attachTransport((logObj) => {
      pluginLogStream.write(JSON.stringify(logObj) + '\n');
    });

    this.tsLog.attachTransport((logObj) => {
      pluginLogLibStream.write(JSON.stringify(logObj) + '\n');
    });

    this.log.debug('Using bropats eufy-security-client library in version ' + libVersion);

    this.config = {
      username: '',
      password: '',
      language: 'en',
      country: 'US',
      trustedDeviceName: 'My Phone',
      persistentDir: this.storagePath,
      p2pConnectionSetup: 0,
      pollingIntervalMinutes: 10,
      eventDurationSeconds: 10,
      acceptInvitations: true,
    } as EufySecurityConfig;

    this.onRequest('/login', this.login.bind(this));
    this.onRequest('/storedAccessories', this.loadStoredAccessories.bind(this));
    this.onRequest('/reset', this.resetPlugin.bind(this));
    this.onRequest('/downloadLogs', this.downloadLogs.bind(this));

    this.ready();
  }

  async resetPersistentData(): Promise<void> {
    try {
      fs.unlinkSync(this.storagePath + '/persistent.json');
    } catch (err) {
      return Promise.reject(err);
    }
  }

  async login(options): Promise<LoginResult> {

    // delete persistent.json if new login
    try {
      if (options && options.username && options.password) {
        this.log.info('deleting persistent.json due to new login');
        await this.resetPersistentData();
      }
    } catch (err) {
      this.log.error('Could not delete persistent.json due to error: ' + err);
    }

    if (!this.eufyClient && options && options.username && options.password && options.country) {
      this.accessories = []; // clear accessories array so that it can be filled with all devices after login
      this.log.debug('init eufyClient');
      this.config.username = options.username;
      this.config.password = options.password;
      this.config.country = options.country;
      this.config.trustedDeviceName = options.deviceName;
      try {
        this.eufyClient = await EufySecurity.initialize(this.config, this.tsLog);
      } catch (err) {
        this.log.error(err);
      }
      this.eufyClient?.on('station added', this.addStation.bind(this));
      this.eufyClient?.on('device added', this.addDevice.bind(this));
    }

    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        resolve({
          success: false,
          failReason: LoginFailReason.TIMEOUT,
        });
      }, 25000);

      if (options && options.username && options.password && options.country) {
        // login with credentials
        this.log.debug('login with credentials');
        try {
          this.loginHandlers(resolve);
          this.eufyClient?.connect()
            .then(() => {
              this.log.debug('connected?: ' + this.eufyClient?.isConnected());
            })
            .catch((err) => this.log.error(err));
        } catch (err) {
          this.log.error(err);
          resolve({
            success: false,
            failReason: LoginFailReason.UNKNOWN,
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
            failReason: LoginFailReason.UNKNOWN,
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
            failReason: LoginFailReason.UNKNOWN,
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

  async loadStoredAccessories(): Promise<Accessory[]> {
    try {
      const accessories = JSON.parse(fs.readFileSync(this.storedAccessories_file, { encoding: 'utf-8' }));
      return Promise.resolve(accessories as Accessory[]);
    } catch (err) {
      this.log.error('Could not get stored accessories. Most likely no stored accessories yet: ' + err);
      return Promise.reject([]);
    }
  }

  loginHandlers(resolveCallback) {
    this.eufyClient?.once('tfa request', () => {
      this.log.debug('tfa request event');
      resolveCallback({
        success: false,
        failReason: LoginFailReason.TFA, // TFA
      });
    });

    this.eufyClient?.once('captcha request', (id, captcha) => {
      this.log.debug('captcha request event');
      resolveCallback({
        success: false,
        failReason: LoginFailReason.CAPTCHA, // Captcha
        data: {
          id: id,
          captcha: captcha,
        },
      });
    });

    this.eufyClient?.once('connect', () => {
      this.log.debug('connect event');
      resolveCallback({
        success: true,
      });
    });
  }

  addStation(station: Station) {
    const s: Accessory = {
      uniqueId: station.getSerial(),
      displayName: station.getName(),
      station: true,
      type: station.getDeviceType(),
    };
    this.accessories.push(s);
    this.storeAccessories();
    this.pushEvent('addAccessory', s);
  }

  addDevice(device: Device) {
    const d: Accessory = {
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

  async resetPlugin() {
    try {
      fs.rmSync(this.storagePath, { recursive: true });
      return { result: 1 }; //file removed
    } catch (err) {
      return { result: 0 }; //error while removing the file
    }
  }

  // TODO: test for different configurations (apt-install, npm -g install, windows, ...)
  async downloadLogs(): Promise<Buffer> {
    this.log.info(`compressing log files to ${this.logZipFilePath} and sending to client.`);
    if (!this.removeCompressedLogs()) {
      this.log.error('There were already old compressed log files that could not be removed!');
      return Promise.reject('There were already old compressed log files that could not be removed!');
    }
    return new Promise((resolve, reject) => {
      const zip = new Zip();
      let numberOfFiles = 0;

      if (fs.existsSync(this.storagePath + '/log-lib.log')) {
        zip.addFile(this.storagePath + '/log-lib.log');
        numberOfFiles++;
      }
      if (fs.existsSync(this.storagePath + '/log-lib.log.0')) {
        zip.addFile(this.storagePath + '/log-lib.log.0');
        numberOfFiles++;
      }
      if (fs.existsSync(this.storagePath + '/log-lib.log.1')) {
        zip.addFile(this.storagePath + '/log-lib.log.1');
        numberOfFiles++;
      }
      if (fs.existsSync(this.storagePath + '/log-lib.log.2')) {
        zip.addFile(this.storagePath + '/log-lib.log.2');
        numberOfFiles++;
      }

      if (fs.existsSync(this.storagePath + '/eufy-log.log')) {
        zip.addFile(this.storagePath + '/eufy-log.log');
        numberOfFiles++;
      }
      if (fs.existsSync(this.storagePath + '/eufy-log.log.0')) {
        zip.addFile(this.storagePath + '/eufy-log.log.0');
        numberOfFiles++;
      }
      if (fs.existsSync(this.storagePath + '/eufy-log.log.1')) {
        zip.addFile(this.storagePath + '/eufy-log.log.1');
        numberOfFiles++;
      }
      if (fs.existsSync(this.storagePath + '/eufy-log.log.2')) {
        zip.addFile(this.storagePath + '/eufy-log.log.2');
        numberOfFiles++;
      }

      if (fs.existsSync(this.storagePath + '/configui-server.log')) {
        zip.addFile(this.storagePath + '/configui-server.log');
        numberOfFiles++;
      }
      if (fs.existsSync(this.storagePath + '/configui-server.log.0')) {
        zip.addFile(this.storagePath + '/configui-server.log.0');
        numberOfFiles++;
      }
      if (fs.existsSync(this.storagePath + '/configui-server.log.1')) {
        zip.addFile(this.storagePath + '/configui-server.log.1');
        numberOfFiles++;
      }
      if (fs.existsSync(this.storagePath + '/configui-server.log.2')) {
        zip.addFile(this.storagePath + '/configui-server.log.2');
        numberOfFiles++;
      }

      if (numberOfFiles === 0) {
        throw new Error('No log files were found');
      }

      this.pushEvent('downloadLogsFileCount', { numberOfFiles: numberOfFiles });

      zip.archive(this.logZipFilePath).then(() => {
        const fileBuffer = fs.readFileSync(this.logZipFilePath);
        resolve(fileBuffer);
      }).catch((err) => {
        this.log.error('Error while generating log files: ' + err);
        reject(err);
      }).finally(() => this.removeCompressedLogs());
      
    });
  }

  private removeCompressedLogs(): boolean {
    try {
      if (fs.existsSync(this.logZipFilePath)) {
        fs.unlinkSync(this.logZipFilePath);
      }
      return true;
    } catch {
      return false;
    }
  }
}

// start the instance of the server
(() => {
  return new UiServer();
})();
