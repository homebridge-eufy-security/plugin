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

import { DeviceIdentifier, DeviceContainer } from './interfaces';

import { StationAccessory } from './accessories/StationAccessory';
import { EntrySensorAccessory } from './accessories/EntrySensorAccessory';
import { MotionSensorAccessory } from './accessories/MotionSensorAccessory';
import { CameraAccessory } from './accessories/CameraAccessory';
import { DoorbellCameraAccessory } from './accessories/DoorbellCameraAccessory';
import { KeypadAccessory } from './accessories/KeypadAccessory';
import { SmartLockAccessory } from './accessories/SmartLockAccessory';

import {
  EufySecurity,
  EufySecurityConfig,
  Device,
  DeviceType,
  Station,
  EntrySensor,
  MotionSensor,
  Camera,
  DoorbellCamera,
  Keypad,
  Lock,
  libVersion,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore 
} from 'eufy-security-client';

import { Logger as TsLogger, ILogObj } from 'tslog';
import { createStream } from 'rotating-file-stream';

import fs from 'fs';

export class EufySecurityPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public eufyClient!: EufySecurity;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public config: EufySecurityPlatformConfig;
  private eufyConfig: EufySecurityConfig;

  public log;
  private tsLogger;

  public readonly eufyPath: string;

  private activeAccessoryIds: string[] = [];
  private cleanCachedAccessoriesTimeout?: NodeJS.Timeout;

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

    const plugin = require('../package.json');

    const mainLogObj = {
      // eslint-disable-next-line max-len
      prettyLogTemplate: `[{{mm}}/{{dd}}/{{yyyy}} {{hh}}:{{MM}}:{{ss}}]\t[EufySecurity-${plugin.version}]\t{{logLevelName}}\t[{{fileNameWithLine}}{{name}}]\t`,
      prettyErrorTemplate: '\n{{errorName}} {{errorMessage}}\nerror stack:\n{{errorStack}}',
      prettyErrorStackTemplate: '  • {{fileName}}\t{{method}}\n\t{{fileNameWithLine}}',
      prettyErrorParentNamesSeparator: ':',
      prettyErrorLoggerNameDelimiter: '\t',
      stylePrettyLogs: true,
      minLevel: (this.config.enableDetailedLogging) ? 2 : 3,
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

    const omitLogFiles = this.config.omitLogFiles ?? false;

    if (!omitLogFiles) {

      const pluginLogStream = createStream('log-lib.log', {
        path: this.eufyPath,
        interval: '1d',
        rotate: 3,
        maxSize: '200M',
      });

      this.log.attachTransport((logObj) => {
        pluginLogStream.write(JSON.stringify(logObj) + '\n');
      });

      // use tslog for eufy-security-client

      const eufyLogStream = createStream('eufy-log.log', {
        path: this.eufyPath,
        interval: '1d',
        rotate: 3,
        maxSize: '200M',
      });

      this.tsLogger = new TsLogger().attachTransport((logObj) => {
        eufyLogStream.write(JSON.stringify(logObj) + '\n');
      });
    }

    this.log.warn('warning: planned changes, see https://github.com/homebridge-eufy-security/plugin/issues/1');

    this.log.debug('plugin data store: ' + this.eufyPath);
    this.log.debug('Using bropats eufy-security-client library in version ' + libVersion);

    if (omitLogFiles) {
      this.log.info('log file storage will be omitted.');
    }

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

      this.eufyClient.on('push connect', () => {
        this.log.debug('Push Connected!');
      });
      this.eufyClient.on('push close', () => {
        this.log.warn('Push Closed!');
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
  }

  private async stationAdded(station: Station) {
    this.log.debug(
      'Found Station',
      station.getSerial(),
      station.getName(),
      DeviceType[station.getDeviceType()],
      station.getLANIPAddress(),
    );

    if (station.getRawStation().member.member_type === 1) {
      this.log.info('You\'re using guest admin account with this plugin! This is recommanded way!');
    } else {
      this.log.error('You\'re not using guest admin account with this plugin! This is not recommanded way!');
      this.log.error('Please look here for more details:');
      this.log.error('https://github.com/homebridge-eufy-security/plugin/wiki/Installation');
      this.log.error(station.getSerial() + ' type: ' + station.getRawStation().member.member_type);
    }

    if (this.config.ignoreStations.indexOf(station.getSerial()) !== -1) {
      this.log.debug('Device ignored');
      return;
    }

    const deviceContainer: DeviceContainer = {
      deviceIdentifier: {
        uniqueId: station.getSerial(),
        displayName: station.getName(),
        type: station.getDeviceType(),
        station: true,
      } as DeviceIdentifier,
      eufyDevice: station,
    };

    this.processAccessory(deviceContainer);
  }

  private async deviceAdded(device: Device) {
    this.log.debug(
      'Found device',
      device.getSerial(),
      device.getName(),
      DeviceType[device.getDeviceType()],
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
        station: false,
      } as DeviceIdentifier,
      eufyDevice: device,
    };

    this.processAccessory(deviceContainer);
  }

  private processAccessory(deviceContainer: DeviceContainer) {
    // generate a unique id for the accessory this should be generated from
    // something globally unique, but constant, for example, the device serial
    // number or MAC address
    let uuid = this.api.hap.uuid.generate(deviceContainer.deviceIdentifier.uniqueId);

    // Checking Device Type if it's not a station, it will be the same serial number we will find
    // in Device list and it will create the same UUID
    if (deviceContainer.deviceIdentifier.type !== DeviceType.STATION && deviceContainer.deviceIdentifier.station) {
      uuid = this.api.hap.uuid.generate('s_' + deviceContainer.deviceIdentifier.uniqueId);
      this.log.debug('This device is not a station. Generating a new UUID to avoid any duplicate issue');
    }

    // add to active accessories (see cleanCache)
    if (this.activeAccessoryIds.indexOf(uuid) === -1) {
      this.activeAccessoryIds.push(uuid);
    }

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const cachedAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (!cachedAccessory) {
      // the accessory does not yet exist, so we need to create it

      // create a new accessory
      const accessory = new this.api.platformAccessory(deviceContainer.deviceIdentifier.displayName, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context['device'] = deviceContainer.deviceIdentifier;

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`

      this.register_accessory(accessory, deviceContainer, false);
    } else {
      this.register_accessory(cachedAccessory, deviceContainer, true);
    }
  }

  private async pluginShutdown() {
    if (this.cleanCachedAccessoriesTimeout) {
      clearTimeout(this.cleanCachedAccessoriesTimeout);
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

  private register_accessory(
    accessory: PlatformAccessory,
    container: DeviceContainer,
    exist: boolean,
  ) {

    this.log.debug(accessory.displayName, 'UUID:', accessory.UUID);

    let unbridge = false;

    const station = container.deviceIdentifier.station;
    let type = container.deviceIdentifier.type;
    const device = container.eufyDevice;

    /* Under development area

    This need to be rewrite 

    */

    if (station) {
      if (type !== DeviceType.STATION) {
        // Allowing camera but not the lock nor doorbell for now
        if (!(type === DeviceType.LOCK_BLE
          || type === DeviceType.LOCK_WIFI
          || type === DeviceType.LOCK_BLE_NO_FINGER
          || type === DeviceType.LOCK_WIFI_NO_FINGER
          || type === DeviceType.DOORBELL
          || type === DeviceType.BATTERY_DOORBELL
          || type === DeviceType.BATTERY_DOORBELL_2
          || type === DeviceType.BATTERY_DOORBELL_PLUS
          || type === DeviceType.DOORBELL_SOLO)) {
          // this.log.warn(accessory.displayName, 'looks station but it\'s not could imply some errors', 'Type:', type);
          type = DeviceType.STATION;
        } else {
          return;
        }
      }
    }

    let a;

    switch (type) {
      case DeviceType.STATION:
      case DeviceType.HB3:
        new StationAccessory(this, accessory, device as Station);
        break;
      case DeviceType.MOTION_SENSOR:
        new MotionSensorAccessory(this, accessory, device as MotionSensor);
        break;
      case DeviceType.CAMERA:
      case DeviceType.CAMERA2:
      case DeviceType.CAMERA_E:
      case DeviceType.CAMERA2C:
      case DeviceType.INDOOR_CAMERA:
      case DeviceType.INDOOR_PT_CAMERA:
      case DeviceType.INDOOR_COST_DOWN_CAMERA:
      case DeviceType.FLOODLIGHT:
      case DeviceType.CAMERA2C_PRO:
      case DeviceType.CAMERA2_PRO:
      case DeviceType.CAMERA3C:
      case DeviceType.CAMERA3:
      case DeviceType.CAMERA_GUN:
      case DeviceType.CAMERA_FG:
      case DeviceType.INDOOR_CAMERA_1080:
      case DeviceType.INDOOR_PT_CAMERA_1080:
      case DeviceType.SOLO_CAMERA:
      case DeviceType.SOLO_CAMERA_PRO:
      case DeviceType.SOLO_CAMERA_SPOTLIGHT_1080:
      case DeviceType.SOLO_CAMERA_SPOTLIGHT_2K:
      case DeviceType.SOLO_CAMERA_SPOTLIGHT_SOLAR:
      case DeviceType.INDOOR_OUTDOOR_CAMERA_1080P:
      case DeviceType.INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT:
      case DeviceType.INDOOR_OUTDOOR_CAMERA_2K:
      case DeviceType.FLOODLIGHT_CAMERA_8422:
      case DeviceType.FLOODLIGHT_CAMERA_8423:
      case DeviceType.FLOODLIGHT_CAMERA_8424:
      case DeviceType.WALL_LIGHT_CAM:
      case DeviceType.WALL_LIGHT_CAM_81A0:
      case DeviceType.CAMERA_GARAGE_T8453_COMMON:
      case DeviceType.CAMERA_GARAGE_T8453:
      case DeviceType.CAMERA_GARAGE_T8452:
        a = new CameraAccessory(this, accessory, device as Camera);
        unbridge = (a.cameraConfig.enableCamera) ? a.cameraConfig.unbridge ??= false : false;
        break;
      case DeviceType.DOORBELL:
      case DeviceType.BATTERY_DOORBELL:
      case DeviceType.BATTERY_DOORBELL_2:
      case DeviceType.BATTERY_DOORBELL_PLUS:
      case DeviceType.DOORBELL_SOLO:
        a = new DoorbellCameraAccessory(this, accessory, device as DoorbellCamera);
        unbridge = (a.cameraConfig.enableCamera) ? a.cameraConfig.unbridge ??= false : false;
        break;
      case DeviceType.SENSOR:
        new EntrySensorAccessory(this, accessory, device as EntrySensor);
        break;
      case DeviceType.LOCK_BLE:
      case DeviceType.LOCK_WIFI:
      case DeviceType.LOCK_BLE_NO_FINGER:
      case DeviceType.LOCK_WIFI_NO_FINGER:
        new SmartLockAccessory(this, accessory, device as Lock);
        break;
      default:
        this.log.warn('This accessory is not compatible with HomeBridge Eufy Security plugin:', accessory.displayName, 'Type:', type);
        return;
    }

    if (exist) {
      if (!unbridge) {
        this.log.info('Updating accessory:', accessory.displayName);
        this.api.updatePlatformAccessories([accessory]);
        return;
      } else {
        this.log.info(`Removing cached accessory ${accessory.UUID} ${accessory.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    if (unbridge) {
      this.log.info('Adding new unbridged accessory:', accessory.displayName);
      this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    } else {
      this.log.info('Adding new accessory:', accessory.displayName);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

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

            if (camera.unbridge) {
              // eslint-disable-next-line max-len
              this.log.warn('Camera ' + cachedAccessory.context['device'].displayName + ' (' + cachedAccessory.context['device'].uniqueId + ') had camera configuration option \'unbridge\' set to true. This will be set to false to maintain functionality. See https://github.com/homebridge-eufy-security/plugin/issues/79 for more information.');
              pluginConfig.cameras[i]['unbridge'] = false;
            }
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