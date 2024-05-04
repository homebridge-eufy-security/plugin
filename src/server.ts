import { EufySecurity, EufySecurityConfig, libVersion, Device, Station, PropertyName, CommandName, DeviceType, UserType } from 'eufy-security-client';
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import fs from 'fs';
import { Logger as TsLogger, ILogObj } from 'tslog';
import { createStream } from 'rotating-file-stream';
import { Zip } from 'zip-lib';
import { Accessory, L_Station, L_Device, LoginResult, LoginFailReason } from './configui/app/util/types';
import { version } from '../package.json';

class UiServer extends HomebridgePluginUiServer {
  public stations: L_Station[] = [];

  private eufyClient: EufySecurity | null = null;
  private log!: TsLogger<ILogObj>;
  private tsLog!: TsLogger<ILogObj>;
  private storagePath: string = this.homebridgeStoragePath + '/eufysecurity';
  private storedAccessories_file: string = this.storagePath + '/accessories.json';
  private logZipFilePath: string = this.storagePath + '/logs.zip';

  private adminAccountUsed: boolean = false;

  public config: EufySecurityConfig = {
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

  constructor() {
    super();
    this.initLogger();
    this.initTransportStreams();
    this.initEventListeners();
    this.ready();
  }

  private initLogger() {
    this.log = new TsLogger({
      name: `[${version}]`,
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
    });
    this.tsLog = new TsLogger({ type: 'hidden', minLevel: 2 });
  }

  private initTransportStreams() {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath);
    }
    const pluginLogStream = createStream('configui-server.log', { path: this.storagePath, interval: '1d', rotate: 3, maxSize: '200M' });
    const pluginLogLibStream = createStream('configui-lib.log', { path: this.storagePath, interval: '1d', rotate: 3, maxSize: '200M' });
    this.log.attachTransport((logObj) => pluginLogStream.write(JSON.stringify(logObj) + '\n'));
    this.tsLog.attachTransport((logObj) => pluginLogLibStream.write(JSON.stringify(logObj) + '\n'));
    this.log.debug('Using bropats eufy-security-client library in version ' + libVersion);
  }

  private initEventListeners() {
    this.onRequest('/login', this.login.bind(this));
    this.onRequest('/storedAccessories', this.loadStoredAccessories.bind(this));
    this.onRequest('/reset', this.resetPlugin.bind(this));
    this.onRequest('/downloadLogs', this.downloadLogs.bind(this));
  }

  async resetPersistentData(): Promise<void> {
    try {
      fs.unlinkSync(this.storagePath + '/persistent.json');
    } catch (err) {
      return Promise.reject(err);
    }
  }

  async login(options): Promise<LoginResult> {
    try {
      if (options && options.username && options.password) {
        this.log.info('deleting persistent.json due to new login');
        await this.resetPersistentData(); // To be commented for testing purpose
      }
    } catch (err) {
      this.log.error('Could not delete persistent.json due to error: ' + err);
    }

    if (!this.eufyClient && options && options.username && options.password && options.country) {
      this.stations = [];
      this.log.debug('init eufyClient');
      this.config.username = options.username;
      this.config.password = options.password;
      this.config.country = options.country;
      this.config.trustedDeviceName = options.deviceName;
      try {
        this.eufyClient = await EufySecurity.initialize(this.config, this.tsLog);
        this.eufyClient?.on('station added', this.addStation.bind(this));
        this.eufyClient?.on('device added', this.addDevice.bind(this));
      } catch (err) {
        this.log.error(err);
      }
    }

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve({ success: false, failReason: LoginFailReason.TIMEOUT });
      }, 25000);

      if (options && options.username && options.password && options.country) {
        this.log.debug('login with credentials');
        try {
          this.loginHandlers(resolve);
          this.eufyClient?.connect()
            .then(() => this.log.debug('connected?: ' + this.eufyClient?.isConnected()))
            .catch((err) => this.log.error(err));
        } catch (err) {
          this.log.error(err);
          resolve({ success: false, failReason: LoginFailReason.UNKNOWN, data: { error: err } });
        }
      } else if (options && options.verifyCode) {
        try {
          this.loginHandlers(resolve);
          this.eufyClient?.connect({ verifyCode: options.verifyCode, force: false });
        } catch (err) {
          resolve({ success: false, failReason: LoginFailReason.UNKNOWN, data: { error: err } });
        }
      } else if (options && options.captcha) {
        try {
          this.loginHandlers(resolve);
          this.eufyClient?.connect({ captcha: { captchaCode: options.captcha.captchaCode, captchaId: options.captcha.captchaId }, force: false });
        } catch (err) {
          resolve({ success: false, failReason: LoginFailReason.UNKNOWN, data: { error: err } });
        }
      } else {
        reject('unsupported login method');
      }
    });
  }

  async loadStoredAccessories(): Promise<Accessory[]> {
    try {
      const storedData = JSON.parse(fs.readFileSync(this.storedAccessories_file, { encoding: 'utf-8' }));
      const { version: storedVersion, stations: storedAccessories } = storedData;

      if (storedVersion !== version) {
        this.pushEvent('versionUnmatched', { currentVersion: version, storedVersion: storedVersion });
        this.log.warn(`Stored version (${storedVersion}) does not match current version (${version})`);
      }

      return Promise.resolve(storedAccessories as Accessory[]);
    } catch (err) {
      this.log.error('Could not get stored accessories. Most likely no stored accessories yet: ' + err);
      return Promise.reject([]);
    }
  }

  loginHandlers(resolveCallback) {
    this.eufyClient?.once('tfa request', () => resolveCallback({ success: false, failReason: LoginFailReason.TFA }));
    this.eufyClient?.once('captcha request', (id, captcha) => resolveCallback({ success: false, failReason: LoginFailReason.CAPTCHA, data: { id: id, captcha: captcha } }));
    this.eufyClient?.once('connect', () => resolveCallback({ success: true }));
  }

  addStation(station: Station) {

    // Before doing anything check if creds are guest admin
    const rawStation = station.getRawStation();
    if (rawStation.member.member_type !== UserType.ADMIN) {
      this.adminAccountUsed = true;
      this.eufyClient?.close();
      this.pushEvent('AdminAccountUsed', true);
      this.resetPlugin();
      this.log.error(`
      #########################
      ######### ERROR #########
      #########################
      You're not using a guest admin account with this plugin! You must use a guest admin account!
      Please look here for more details: 
      https://github.com/homebridge-eufy-security/plugin/wiki/Create-a-dedicated-admin-account-for-Homebridge-Eufy-Security-Plugin
      #########################
      `);
      return;
    }

    const s: L_Station = {
      uniqueId: station.getSerial(),
      displayName: station.getName(),
      type: station.getDeviceType(),
      typename: DeviceType[station.getDeviceType()],
      disabled: false,
      devices: [],
    };
    s.ignored = (this.config['ignoreStations'] ?? []).includes(s.uniqueId);

    // Standalone Lock or Doorbell doesn't have Security Control
    if (Device.isLock(s.type) || Device.isDoorbell(s.type)) {
      s.disabled = true;
      s.ignored = true;
    }

    this.stations.push(s);
    this.storeAccessories();
    this.pushEvent('addAccessory', this.stations);
  }

  addDevice(device: Device) {
    // Before doing anything check if creds are guest admin
    if (this.adminAccountUsed) {
      this.pushEvent('AdminAccountUsed', true);
      return;
    }

    const d: L_Device = {
      uniqueId: device.getSerial(),
      displayName: device.getName(),
      type: device.getDeviceType(),
      typename: DeviceType[device.getDeviceType()],
      standalone: device.getSerial() === device.getStationSerial(),
      hasBattery: device.hasBattery(),
      isCamera: device.isCamera(),
      isDoorbell: device.isDoorbell(),
      supportsRTSP: device.hasPropertyValue(PropertyName.DeviceRTSPStream),
      supportsTalkback: device.hasCommand(CommandName.DeviceStartTalkback),
      DeviceEnabled: device.hasProperty(PropertyName.DeviceEnabled),
      DeviceMotionDetection: device.hasProperty(PropertyName.DeviceMotionDetection),
      DeviceLight: device.hasProperty(PropertyName.DeviceLight),
      DeviceChimeIndoor: device.hasProperty(PropertyName.DeviceChimeIndoor),
      disabled: false,
    };

    if (device.hasProperty(PropertyName.DeviceChargingStatus)) {
      d.chargingStatus = (device.getPropertyValue(PropertyName.DeviceChargingStatus) as number);
    }

    d.ignored = (this.config['ignoreDevices'] ?? []).includes(d.uniqueId);

    const stationUniqueId = device.getStationSerial();
    const stationIndex = this.stations.findIndex(station => station.uniqueId === stationUniqueId);

    if (stationIndex !== -1) {
      if (!this.stations[stationIndex].devices) {
        this.stations[stationIndex].devices = [];
      }
      this.stations[stationIndex].devices!.push(d);
      this.storeAccessories();
      this.pushEvent('addAccessory', this.stations);
    } else {
      this.log.error('Station not found for device:', d.displayName);
    }
  }

  storeAccessories() {
    const dataToStore = { version: version, stations: this.stations };
    fs.writeFileSync(this.storedAccessories_file, JSON.stringify(dataToStore));
  }

  async resetPlugin() {
    try {
      fs.rmSync(this.storagePath, { recursive: true });
      return { result: 1 };
    } catch (err) {
      return { result: 0 };
    }
  }

  async downloadLogs(): Promise<Buffer> {
    this.log.info(`compressing log files to ${this.logZipFilePath} and sending to client.`);
    if (!this.removeCompressedLogs()) {
      this.log.error('There were already old compressed log files that could not be removed!');
      return Promise.reject('There were already old compressed log files that could not be removed!');
    }
    return new Promise((resolve, reject) => {
      const zip = new Zip();
      let numberOfFiles = 0;
      ['eufy-lib.log', 'eufy-security.log', 'ffmpeg.log', 'configui-lib.log', 'configui-server.log'].forEach(logFile => {
        for (let i = 0; i < 3; i++) {
          const fileName = i === 0 ? logFile : `${logFile}.${i}`;
          const filePath = `${this.storagePath}/${fileName}`;
          if (fs.existsSync(filePath)) {
            zip.addFile(filePath);
            numberOfFiles++;
          }
        }
      });

      if (numberOfFiles === 0) {
        throw new Error('No log files were found');
      }

      this.pushEvent('downloadLogsFileCount', { numberOfFiles: numberOfFiles });

      zip.archive(this.logZipFilePath)
        .then(() => {
          const fileBuffer = fs.readFileSync(this.logZipFilePath);
          resolve(fileBuffer);
        })
        .catch((err) => {
          this.log.error('Error while generating log files: ' + err);
          reject(err);
        })
        .finally(() => this.removeCompressedLogs());
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

// Start the instance of the server
new UiServer();