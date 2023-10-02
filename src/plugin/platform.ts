/* eslint @typescript-eslint/no-var-requires: "off" */
import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

import { EufySecurityPlatformConfig } from './config';

import { DeviceIdentifier, StationContainer, DeviceContainer } from './interfaces';

import { StationAccessory } from './accessories/StationAccessory';
import { EntrySensorAccessory } from './accessories/EntrySensorAccessory';
import { MotionSensorAccessory } from './accessories/MotionSensorAccessory';
import { CameraAccessory } from './accessories/CameraAccessory';
import { LockAccessory } from './accessories/LockAccessory';

import {
  EufySecurity,
  EufySecurityConfig,
  Device,
  DeviceType,
  Station,
  EntrySensor,
  MotionSensor,
  Camera,
  UserType,
  Lock,
  libVersion,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore 
} from 'eufy-security-client';

import { Logger as TsLogger, ILogObj } from 'tslog';
import { createStream } from 'rotating-file-stream';

import fs from 'fs';

import { EufyClientInteractor } from './utils/EufyClientInteractor';
import { initializeExperimentalMode } from './utils/experimental';

import os from 'node:os';
import { platform } from 'node:process';
import { readFileSync } from 'node:fs';
import { FfmpegCodecs } from './utils/ffmpeg-codec';
import { RtpPortAllocator } from './utils/rtp.js';

export class EufySecurityPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public eufyClient!: EufySecurity;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public config: EufySecurityPlatformConfig;
  private eufyConfig: EufySecurityConfig = {} as EufySecurityConfig;

  public log: TsLogger<ILogObj> = {} as TsLogger<ILogObj>;
  private tsLogger: TsLogger<ILogObj> = {} as TsLogger<ILogObj>;
  public ffmpegLogger: TsLogger<ILogObj> = {} as TsLogger<ILogObj>;
  private already_shutdown: boolean = false;

  public readonly eufyPath: string;

  private activeAccessoryIds: string[] = [];
  private cleanCachedAccessoriesTimeout?: NodeJS.Timeout;

  private pluginConfigInteractor?: EufyClientInteractor;

  private readonly STATION_INIT_DELAY = 5 * 1000; // 5 seconds
  private readonly DEVICE_INIT_DELAY = 7 * 1000; // 7 seconds;

  private _hostSystem: string = '';
  public readonly codecSupport: FfmpegCodecs = new FfmpegCodecs(this);
  public readonly rtpPorts: RtpPortAllocator = new RtpPortAllocator();
  public verboseFfmpeg: boolean = false;

  constructor(
    public readonly hblog: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.config = config as EufySecurityPlatformConfig;

    this.eufyPath = this.api.user.storagePath() + '/eufysecurity';

    if (!fs.existsSync(this.eufyPath)) {
      fs.mkdirSync(this.eufyPath);
    }
    // Identify what we're running on so we can take advantage of hardware-specific features.
    this.probeHwOs();

    this.configureLogger();
    this.initSetup();
  }

  private configureLogger() {
    const plugin = require('../package.json');

    const logOptions = {
      name: (this.config.enableDetailedLogging) ? `[EufySecurity-${plugin.version}]` : '[EufySecurity]',
      prettyLogTemplate: (this.config.enableDetailedLogging)
        // eslint-disable-next-line max-len
        ? '[{{mm}}/{{dd}}/{{yyyy}} {{hh}}:{{MM}}:{{ss}}]\t{{name}}\t{{logLevelName}}\t[{{fileNameWithLine}}]\t'
        : '[{{mm}}/{{dd}}/{{yyyy}}, {{hh}}:{{MM}}:{{ss}}]\t{{name}}\t{{logLevelName}}\t',
      prettyErrorTemplate: '\n{{errorName}} {{errorMessage}}\nerror stack:\n{{errorStack}}',
      prettyErrorStackTemplate: '  • {{fileName}}\t{{method}}\n\t{{fileNameWithLine}}',
      prettyErrorParentNamesSeparator: ':',
      prettyErrorLoggerNameDelimiter: '\t',
      stylePrettyLogs: true,
      minLevel: (this.config.enableDetailedLogging) ? 2 : 3,
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

    this.log = new TsLogger(logOptions);
    this.tsLogger = new TsLogger({ ...logOptions, type: 'hidden' });
    this.ffmpegLogger = new TsLogger({ ...logOptions, type: 'hidden' });

    const omitLogFiles = this.config.omitLogFiles ?? false;

    if (omitLogFiles) {
      this.log.info('log file storage will be omitted.');
    }

    if (!omitLogFiles) {
      // Log streams configuration
      const logStreams = [
        { name: 'eufy-security.log', logger: this.log },
        { name: 'ffmpeg.log', logger: this.ffmpegLogger },
        { name: 'eufy-log.log', logger: this.tsLogger },
      ];

      for (const { name, logger } of logStreams) {
        const logStream = createStream(name, {
          path: this.eufyPath,
          interval: '1d',
          rotate: 3,
          maxSize: '200M',
        });

        logger.attachTransport((logObj) => {
          logStream.write(JSON.stringify(logObj) + '\n');
        });

      }
    }
  }

  // Identify what hardware and operating system environment we're actually running on.
  private probeHwOs(): void {

    // Start off with a generic identifier.
    this._hostSystem = 'generic';

    // Take a look at the platform we're on for an initial hint of what we are.
    switch (platform) {

      // The beloved macOS.
      case 'darwin':

        this._hostSystem = 'macOS.' + (os.cpus()[0].model.includes('Apple') ? 'Apple' : 'Intel');

        break;

      // The indomitable Linux.
      case 'linux':

        // Let's further see if we're a small, but scrappy, Raspberry Pi.
        try {

          // As of the 4.9 kernel, Raspberry Pi prefers to be identified using this method and has deprecated cpuinfo.
          const systemId = readFileSync('/sys/firmware/devicetree/base/model', { encoding: 'utf8' });

          // Is it a Pi 4?
          if (/Raspberry Pi (Compute Module )?4/.test(systemId)) {

            this._hostSystem = 'raspbian';
          }
        } catch (error) {

          // We aren't especially concerned with errors here, given we're just trying to ascertain the system information through hints.
        }

        break;

      default:

        // We aren't trying to solve for every system type.
        break;
    }
  }

  // Utility to return the hardware environment we're on.
  public get hostSystem(): string {

    return this._hostSystem;
  }

  private initSetup() {

    this.log.warn('warning: planned changes, see https://github.com/homebridge-eufy-security/plugin/issues/1');

    this.log.debug('plugin data store: ' + this.eufyPath);
    this.log.debug('Using bropats eufy-security-client library in version ' + libVersion);

    this.clean_config();

    this.eufyConfig = {
      username: this.config.username,
      password: this.config.password,
      country: this.config.country ?? 'US',
      trustedDeviceName: this.config.deviceName ?? 'My Phone',
      language: 'en',
      persistentDir: this.eufyPath,
      p2pConnectionSetup: 0,
      pollingIntervalMinutes: this.config.pollingIntervalMinutes ?? 10,
      eventDurationSeconds: 10,
    } as EufySecurityConfig;

    this.config.ignoreStations = this.config.ignoreStations ??= [];
    this.config.ignoreDevices = this.config.ignoreDevices ??= [];
    this.config.cleanCache = this.config.cleanCache ??= true;
    this.config.unbridge = this.config.unbridge ??= true;

    this.log.info('Country set:', this.config.country ?? 'US');

    // This function is here to avoid any break while moving from 1.0.x to 1.1.x
    // moving persistent into our dedicated folder (this need to be removed after few release of 1.1.x)
    if (fs.existsSync(this.api.user.storagePath() + '/persistent.json')) {
      this.log.debug('An old persistent file have been found');
      if (!fs.existsSync(this.eufyPath + '/persistent.json')) {
        fs.copyFileSync(this.api.user.storagePath() + '/persistent.json', this.eufyPath + '/persistent.json', fs.constants.COPYFILE_EXCL);
      } else {
        this.log.debug('but the new one is already present');
      }
      fs.unlinkSync(this.api.user.storagePath() + '/persistent.json');
    }
    // ********

    this.api.on('didFinishLaunching', async () => {
      this.clean_config_after_init();
      await this.pluginSetup();
    });
    this.api.on('shutdown', async () => {
      await this.pluginShutdown();
    });

    this.log.info('Finished initializing!');
  }

  private async pluginSetup() {

    try {
      this.eufyClient = (this.config.enableDetailedLogging)
        ? await EufySecurity.initialize(this.eufyConfig, this.tsLogger)
        : await EufySecurity.initialize(this.eufyConfig);

      this.eufyClient.on('station added', this.stationAdded.bind(this));
      this.eufyClient.on('device added', this.deviceAdded.bind(this));
      this.eufyClient.on('device removed', this.deviceRemoved.bind(this));

      this.eufyClient.on('push connect', () => {
        this.log.debug('Push Connected!');
      });
      this.eufyClient.on('push close', () => {
        this.log.debug('Push Closed!');
      });
      this.eufyClient.on('connect', () => {
        this.log.debug('Connected!');
      });
      this.eufyClient.on('close', () => {
        this.log.debug('Closed!');
      });
      this.eufyClient.on('connection error', async (error: Error) => {
        this.log.debug('Error: ', error);
        await this.pluginShutdown();
      });
      this.eufyClient.once('captcha request', async (id, captcha) => {
        this.log.error(`
        ***************************
        ***** WARNING MESSAGE *****
        ***************************
        Important Notice: CAPTCHA Required
        Your account seems to have triggered a security measure that requires CAPTCHA verification for the next 24 hours...
        Please abstain from any activities until this period elapses...
        Should your issue persist beyond this timeframe, you may need to consider setting up a new account.
        For more detailed instructions, please consult:
        https://github.com/homebridge-eufy-security/plugin/wiki/Create-a-dedicated-admin-account-for-Homebridge-Eufy-Security-Plugin
        ***************************
        `);
        await this.pluginShutdown();
      });
      this.eufyClient.on('tfa request', async () => {
        this.log.error(`
        ***************************
        ***** WARNING MESSAGE *****
        ***************************
        Attention: Two-Factor Authentication (2FA) Requested
        It appears that your account is currently under a temporary 24-hour flag for security reasons...
        Kindly refrain from making any further attempts during this period...
        If your concern remains unresolved after 24 hours, you may need to consider creating a new account.
        For additional information, refer to:
        https://github.com/homebridge-eufy-security/plugin/wiki/Create-a-dedicated-admin-account-for-Homebridge-Eufy-Security-Plugin
        ***************************
        `);
        await this.pluginShutdown();
      });

    } catch (e) {
      this.log.error('Error while setup : ', e);
      this.log.error('Not connected can\'t continue!');
      return;
    }

    try {
      await this.eufyClient.connect();
      this.log.debug('EufyClient connected ' + this.eufyClient.isConnected());
    } catch (e) {
      this.log.error('Error authenticating Eufy : ', e);
    }

    if (!this.eufyClient.isConnected()) {
      this.log.error('Not connected can\'t continue!');
      return;
    }

    // give the connection 45 seconds to discover all devices
    // clean old accessories after that time
    this.cleanCachedAccessoriesTimeout = setTimeout(() => {
      this.cleanCachedAccessories();
    }, 45 * 1000);

    let cameraMaxLivestreamDuration = this.config.CameraMaxLivestreamDuration ?? 30;
    if (cameraMaxLivestreamDuration > 86400) {
      cameraMaxLivestreamDuration = 86400;
      // eslint-disable-next-line max-len
      this.log.warn('Your maximum livestream duration value is too large. Since this can cause problems it was reset to 86400 seconds (1 day maximum).');
    }

    this.eufyClient.setCameraMaxLivestreamDuration(cameraMaxLivestreamDuration);
    this.log.debug('CameraMaxLivestreamDuration:', this.eufyClient.getCameraMaxLivestreamDuration());

    try {
      this.pluginConfigInteractor = new EufyClientInteractor(this.eufyPath, this.log, this.eufyClient);
      await this.pluginConfigInteractor.setupServer();
    } catch (err) {
      this.log.warn(err);
    }
  }

  private generateUUID(identifier: string, type: DeviceType): string {
    const prefix = type === DeviceType.STATION ? '' : 's_';
    return this.api.hap.uuid.generate(prefix + identifier);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async addOrUpdateAccessory(deviceContainer: StationContainer | DeviceContainer, isStation: boolean) {
    try {
      const uuid = this.generateUUID(deviceContainer.deviceIdentifier.uniqueId, deviceContainer.deviceIdentifier.type);
      const cachedAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

      let unbridge = false;

      if (cachedAccessory) {
        this.accessories.splice(this.accessories.indexOf(cachedAccessory), 1); // Remove from the accessories array
      }

      const accessory = cachedAccessory || new this.api.platformAccessory(deviceContainer.deviceIdentifier.displayName, uuid);
      accessory.context['device'] = deviceContainer.deviceIdentifier;


      if (isStation) {
        this.register_station(accessory, deviceContainer as StationContainer);
      } else {
        unbridge = this.register_device(accessory, deviceContainer as DeviceContainer);
      }

      if (cachedAccessory) {
        if (!unbridge) {
          // Rule: if a device exists and it's not a camera
          this.api.updatePlatformAccessories([accessory]);
          this.log.info(`Updating existing accessory: ${accessory.displayName}`);
        } else if (this.config.unbridge) {
          // Rule: if a device exists, it's a camera, and unbridge is true
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.log.info(`Unregistering unbridged accessory: ${accessory.displayName}`);
        }
      } else {
        if (!unbridge) {
          // Rule: if a device doesn't exist and it's not a camera
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.log.info(`Registering new accessory: ${accessory.displayName}`);
        } else {
          if (this.config.unbridge) {
            // Rule: if a device doesn't exist, it's a camera, and unbridge is true
            this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
            this.log.info(`Publishing unbridged accessory externally: ${accessory.displayName}`);
          } else {
            // Rule: if a device doesn't exist, it's a camera, and unbridge is false
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            this.log.info(`Registering new accessory: ${accessory.displayName}`);
          }
        }
      }
    } catch (error) {
      this.log.error(`Error in ${isStation ? 'stationAdded' : 'deviceAdded'}:`, error);
    }
  }

  private async stationAdded(station: Station) {
    try {

      if (this.config.ignoreStations.includes(station.getSerial())) {
        this.log.debug(station.getName(), ': Station ignored');
        return;
      }

      const rawStation = station.getRawStation();
      if (rawStation.member.member_type !== UserType.ADMIN) {
        await this.pluginShutdown();
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

      const deviceContainer: StationContainer = {
        deviceIdentifier: {
          uniqueId: station.getSerial(),
          displayName: station.getName(),
          type: station.getDeviceType(),
        } as DeviceIdentifier,
        eufyDevice: station,
      };

      await this.delay(this.STATION_INIT_DELAY);
      this.log.debug(`${deviceContainer.deviceIdentifier.displayName} pre-caching complete`);

      this.addOrUpdateAccessory(deviceContainer, true);
    } catch (error) {
      this.log.error('Error in stationAdded:', error);
    }
  }

  private async deviceAdded(device: Device) {
    try {
      if (this.config.ignoreDevices.includes(device.getSerial())) {
        this.log.debug(device.getName(), ': Device ignored');
        return;
      }

      const deviceContainer: DeviceContainer = {
        deviceIdentifier: {
          uniqueId: device.getSerial(),
          displayName: device.getName(),
          type: device.getDeviceType(),
        } as DeviceIdentifier,
        eufyDevice: device,
      };

      await this.delay(this.DEVICE_INIT_DELAY);
      this.log.debug(`${deviceContainer.deviceIdentifier.displayName} pre-caching complete`);

      this.addOrUpdateAccessory(deviceContainer, false);
    } catch (error) {
      this.log.error('Error in deviceAdded:', error);
    }
  }

  private async deviceRemoved(device: Device) {
    const serial = device.getSerial();

    this.log.debug(
      'A device has been removed',
      serial,
    );

    if (this.config.ignoreDevices.indexOf(device.getSerial()) !== -1) {
      this.log.debug('Device ignored');
      return;
    }

    const deviceContainer: DeviceContainer = {
      deviceIdentifier: {
        uniqueId: device.getSerial(),
        displayName: device.getName(),
        type: device.getDeviceType(),
      } as DeviceIdentifier,
      eufyDevice: device,
    };

    // this.processAccessory(deviceContainer);
  }

  private async pluginShutdown() {

    // Ensure a single shutdown to prevent corruption of the persistent file.
    // This also enables captcha through the GUI and prevents repeated captcha or 2FA prompts upon plugin restart.
    if (this.already_shutdown) {
      return;
    }

    this.already_shutdown = true;

    if (this.cleanCachedAccessoriesTimeout) {
      clearTimeout(this.cleanCachedAccessoriesTimeout);
    }

    if (this.pluginConfigInteractor) {
      this.pluginConfigInteractor.stopServer();
    }

    try {
      this.eufyClient.close();
      this.log.info('Finished shutdown!');
    } catch (e) {
      this.log.error('Error while shutdown : ', e);
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  private cleanCachedAccessories() {
    if (this.config.cleanCache) {
      this.log.info('Looking for old cached accessories that seem to be outdated...');
      let num = 0;

      const staleAccessories = this.accessories.filter((item) => {
        return this.activeAccessoryIds.indexOf(item.UUID) === -1;
      });

      staleAccessories.forEach((staleAccessory) => {
        this.log.info(`Removing cached accessory ${staleAccessory.UUID} ${staleAccessory.displayName}`);
        num++;
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [staleAccessory]);
      });

      if (num > 0) {
        this.log.info('Removed ' + num + ' cached accessories');
      } else {
        this.log.info('No outdated cached accessories found.');
      }
    }
  }

  private register_station(
    accessory: PlatformAccessory,
    container: StationContainer,
  ) {

    this.log.debug(accessory.displayName, 'UUID:', accessory.UUID);

    const type = container.deviceIdentifier.type;
    const station = container.eufyDevice;

    if (type !== DeviceType.STATION) {
      // Allowing camera but not the lock nor doorbell for now
      if ((type === DeviceType.LOCK_BLE
        || type === DeviceType.LOCK_WIFI
        || type === DeviceType.LOCK_BLE_NO_FINGER
        || type === DeviceType.LOCK_WIFI_NO_FINGER
        || type === DeviceType.DOORBELL
        || type === DeviceType.BATTERY_DOORBELL
        || type === DeviceType.BATTERY_DOORBELL_2
        || type === DeviceType.BATTERY_DOORBELL_PLUS
        || type === DeviceType.DOORBELL_SOLO)) {
        // this.log.warn(accessory.displayName, 'looks station but it\'s not could imply some errors', 'Type:', type);
        return;
      }
    }

    new StationAccessory(this, accessory, station as Station);
  }

  private register_device(
    accessory: PlatformAccessory,
    container: DeviceContainer,
  ): boolean {

    this.log.debug(accessory.displayName, 'UUID:', accessory.UUID);
    const device = container.eufyDevice;

    let isCamera = false;

    if (device.isCamera()) {
      this.log.debug(accessory.displayName, 'isCamera!');
      new CameraAccessory(this, accessory, device as Camera);
      isCamera = true;
    }

    if (device.isMotionSensor()) {
      this.log.debug(accessory.displayName, 'isMotionSensor!');
      new MotionSensorAccessory(this, accessory, device as MotionSensor);
    }

    if (device.isEntrySensor()) {
      this.log.debug(accessory.displayName, 'isEntrySensor!');
      new EntrySensorAccessory(this, accessory, device as EntrySensor);
    }

    if (device.isLock()) {
      this.log.debug(accessory.displayName, 'isLock!');
      new LockAccessory(this, accessory, device as Lock);
    }

    return isCamera;
  }

  public getStationById(id: string) {
    return this.eufyClient.getStation(id);
  }

  private clean_config() {
    try {
      const currentConfig = JSON.parse(fs.readFileSync(this.api.user.configPath(), 'utf8'));
      // check the platforms section is an array before we do array things on it
      if (!Array.isArray(currentConfig.platforms)) {
        throw new Error('Cannot find platforms array in config');
      }
      // find this plugins current config
      const pluginConfig = currentConfig.platforms.find((x: { platform: string }) => x.platform === PLATFORM_NAME);

      if (!pluginConfig) {
        throw new Error(`Cannot find config for ${PLATFORM_NAME} in platforms array`);
      }

      // Cleaning space

      const i = ['hkHome', 'hkAway', 'hkNight', 'hkOff', 'pollingIntervalMinutes', 'CameraMaxLivestreamDuration'];

      Object.entries(pluginConfig).forEach(([key, value]) => {
        if (!i.includes(key)) {
          return;
        }
        pluginConfig[key] = (typeof pluginConfig[key] === 'string') ? parseInt(value as string) : value;
      });

      // End of Cleaning space

      // Applying clean and save it
      this.config = pluginConfig;
      fs.writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4));

    } catch (e) {
      this.log.error('Error cleaning config:', e);
    }
  }

  // this needs to be called after api did finished launching so that cached accessories are already loaded
  private clean_config_after_init() {
    try {
      const currentConfig = JSON.parse(fs.readFileSync(this.api.user.configPath(), 'utf8'));
      // check the platforms section is an array before we do array things on it
      if (!Array.isArray(currentConfig.platforms)) {
        throw new Error('Cannot find platforms array in config');
      }
      // find this plugins current config
      const pluginConfig = currentConfig.platforms.find((x: { platform: string }) => x.platform === PLATFORM_NAME);

      if (!pluginConfig) {
        throw new Error(`Cannot find config for ${PLATFORM_NAME} in platforms array`);
      }

      // Cleaning space
      // clean device specific parametes

      const cameras = (Array.isArray(pluginConfig.cameras)) ? pluginConfig.cameras : null;

      if (cameras && this.accessories.length > 0) {
        for (let i = 0; i < cameras.length; i++) {
          const camera = cameras[i];
          const cachedAccessory = this.accessories.find((acc) => camera.serialNumber === acc.context['device'].uniqueId);
          if (cachedAccessory && Device.isDoorbell(cachedAccessory.context['device'].type) && !camera.enableCamera) {
            // eslint-disable-next-line max-len
            this.log.warn('Found camera ' + cachedAccessory.context['device'].displayName + ' (' + cachedAccessory.context['device'].uniqueId + ') with invalid camera configuration option enableCamera. Attempt to repair. This should only happen once per device...');
            pluginConfig.cameras[i]['enableCamera'] = true;

            // if (camera.unbridge) {
            // eslint-disable-next-line max-len
            //   this.log.warn('Camera ' + cachedAccessory.context['device'].displayName + ' (' + cachedAccessory.context['device'].uniqueId + ') had camera configuration option \'unbridge\' set to true. This will be set to false to maintain functionality. See https://github.com/homebridge-eufy-security/plugin/issues/79 for more information.');
            //   pluginConfig.cameras[i]['unbridge'] = false;
            // }
          }
        }
      }

      // End of Cleaning space

      // Applying clean and save it
      this.config = pluginConfig;

      this.config.ignoreStations = this.config.ignoreStations ??= [];
      this.config.ignoreDevices = this.config.ignoreDevices ??= [];
      this.config.cleanCache = this.config.cleanCache ??= true;

      fs.writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4));

    } catch (e) {
      this.log.error('Error cleaning config:', e);
    }
  }
}