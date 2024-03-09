/* eslint-disable @typescript-eslint/no-var-requires */
import {
  EufySecurity,
  EufySecurityConfig,
  libVersion,
  Device,
  Station,
  PropertyName,
  CommandName,
  DeviceType,
} from 'eufy-security-client';
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';

import fs from 'fs';

import { Logger as TsLogger, ILogObj } from 'tslog';
import { createStream } from 'rotating-file-stream';
import { Zip } from 'zip-lib';

import { Accessory, L_Station, L_Device } from './configui/app/util/types';
import { LoginResult, LoginFailReason } from './configui/app/util/types';
import { EufyClientInteractor } from './plugin/utils/EufyClientInteractor';

class UiServer extends HomebridgePluginUiServer {
  stations: L_Station[] = [];

  config: EufySecurityConfig;
  private eufyClient: EufySecurity | null = null;

  private log: TsLogger<ILogObj>;
  private tsLog: TsLogger<ILogObj>;

  private storagePath: string = this.homebridgeStoragePath + '/eufysecurity';
  private storedAccessories_file: string = this.storagePath + '/accessories.json';
  private logZipFilePath: string = this.storagePath + '/logs.zip';

  private pluginConfigInteractor: EufyClientInteractor;

  constructor() {
    super();

    const plugin = require('../package.json');

    const mainLogObj = {
      name: `[${plugin.version}]`,
      // eslint-disable-next-line max-len
      prettyLogTemplate: '{{name}}\t{{logLevelName}}\t[{{fileNameWithLine}}]\t',
      prettyErrorTemplate: '\n{{errorName}} {{errorMessage}}\nerror stack:\n{{errorStack}}',
      prettyErrorStackTemplate: '  • {{fileName}}\t{{method}}\n\t{{fileNameWithLine}}',
      prettyErrorParentNamesSeparator: ':',
      prettyErrorLoggerNameDelimiter: '\t',
      stylePrettyLogs: true,
      minLevel: 2,
      prettyLogTimeZone: 'local' as 'local' | 'local',
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
        dateIsoStr: 'gray',
        filePathWithLine: 'white',
        name: 'green',
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

    this.pluginConfigInteractor = new EufyClientInteractor(this.storagePath, this.log);

    this.onRequest('/getChargingStatus', (sn: string) => {
      return this.pluginConfigInteractor.DeviceIsCharging(sn);
    });

    this.onRequest('/hasProperty',
      (options: {
        sn: string;
        propertyName: string;
      }) => {
        return this.pluginConfigInteractor.DeviceHasProperty(options.sn, PropertyName[options.propertyName]);
      });

    this.onRequest('/getStationDeviceMapping', () => {
      return this.pluginConfigInteractor.GetStationCamerasMapping();
    });

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
      this.stations = []; // clear accessories array so that it can be filled with all devices after login
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
    const s: L_Station = {
      uniqueId: station.getSerial(),
      displayName: station.getName(),
      type: station.getDeviceType(),
      typename: DeviceType[station.getDeviceType()],
    };
    this.stations.push(s);
    this.storeAccessories();
    this.pushEvent('addAccessory', s);
  }

  addDevice(device: Device) {
    const d: L_Device = {
      uniqueId: device.getSerial(),
      displayName: device.getName(),
      type: device.getDeviceType(),
      typename: DeviceType[device.getDeviceType()],
      hasBattery: device.hasBattery(),
      isCamera: device.isCamera(),
      isDoorbell: device.isDoorbell(),
      supportsRTSP: device.hasPropertyValue(PropertyName.DeviceRTSPStream),
      supportsTalkback: device.hasCommand(CommandName.DeviceStartTalkback),
    };

    // Get the station's unique ID from the device
    const stationUniqueId = device.getStationSerial();

    // Find the station in the stations array based on its unique ID
    const stationIndex = this.stations.findIndex(station => station.uniqueId === stationUniqueId);

    // If the station is found, push the device into its devices array
    if (stationIndex !== -1) {
      // Ensure devices array exists for the station
      if (!this.stations[stationIndex].devices) {
        this.stations[stationIndex].devices = [];
      }
      this.stations[stationIndex].devices!.push(d); // Ensure devices array is not null/undefined
      this.storeAccessories();
      this.pushEvent('addAccessory', d);
    } else {
      this.log.error('Station not found for device:', d.displayName);
    }
  }

  storeAccessories() {
    fs.writeFileSync(this.storedAccessories_file, JSON.stringify(this.stations));
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
