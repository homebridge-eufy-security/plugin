/* eslint @typescript-eslint/no-var-requires: "off" */
import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  APIEvent,
} from 'homebridge';

import { version } from 'process';

import { PLATFORM_NAME, PLUGIN_NAME, SnapshotBlackPath, SnapshotUnavailablePath } from './settings';

import { EufySecurityPlatformConfig } from './config';

import { DeviceIdentifier, StationContainer, DeviceContainer } from './interfaces';

import { StationAccessory } from './accessories/StationAccessory';
import { EntrySensorAccessory } from './accessories/EntrySensorAccessory';
import { MotionSensorAccessory } from './accessories/MotionSensorAccessory';
import { CameraAccessory } from './accessories/CameraAccessory';
import { LockAccessory } from './accessories/LockAccessory';
import { AutoSyncStationAccessory } from './accessories/AutoSyncStationAccessory';

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
  LogLevel,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore 
} from 'eufy-security-client';

import { ILogObjMeta } from 'tslog';
import { createStream } from 'rotating-file-stream';

import fs from 'fs';

import os from 'node:os';
import { platform } from 'node:process';
import { readFileSync } from 'node:fs';

import ffmpegPath from 'ffmpeg-for-homebridge';
import { init_log, log, tsLogger, ffmpegLogger } from './utils/utils';

export class EufySecurityPlatform implements DynamicPlatformPlugin {
  public eufyClient: EufySecurity = {} as EufySecurity;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public config: EufySecurityPlatformConfig;
  private eufyConfig: EufySecurityConfig = {} as EufySecurityConfig;

  private already_shutdown: boolean = false;

  public videoProcessor!: string;

  public readonly eufyPath: string;

  private activeAccessoryIds: string[] = [];
  private cleanCachedAccessoriesTimeout?: NodeJS.Timeout;

  private readonly STATION_INIT_DELAY = 5 * 1000; // 5 seconds
  private readonly DEVICE_INIT_DELAY = 7 * 1000; // 7 seconds;

  private _hostSystem: string = '';
  public verboseFfmpeg: boolean = true;

  public blackSnapshot: Buffer = this.readFileSync(SnapshotBlackPath);
  public SnapshotUnavailable: Buffer = this.readFileSync(SnapshotUnavailablePath);

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
      prettyErrorParentNamesSeparator: '',
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
      maskValuesOfKeys: [
        'username',
        'password',
        'serialnumber',
        'serialNumber',
        'stationSerialNumber',
        'data',
        'ignoreStations',
        'ignoreDevices',
      ],
    };

    init_log(logOptions);

    const omitLogFiles = this.config.omitLogFiles ?? false;

    if (omitLogFiles) {
      log.info('log file storage will be omitted.');
    }

    if (!omitLogFiles) {
      // Log streams configuration
      const logStreams = [
        { name: 'eufy-security.log', logger: log },
        { name: 'ffmpeg.log', logger: ffmpegLogger },
        { name: 'eufy-lib.log', logger: tsLogger },
      ];

      for (const { name, logger } of logStreams) {
        const logStream = createStream(name, {
          path: this.eufyPath,
          interval: '1d',
          rotate: 3,
          maxSize: '200M',
        });

        logger.attachTransport((logObj: ILogObjMeta) => {
          const meta = logObj['_meta'];
          const name = meta.name;
          const level = meta.logLevelName;
          const date = meta.date.toISOString();
          const fileNameWithLine = meta.path?.fileNameWithLine || 'UNKNOWN_FILE';

          // Initialize the message
          let message = '';

          // Loop through logObj from index 0 to 5 and append values to the message
          for (let i = 0; i <= 5; i++) {
            if (logObj[i]) {
              message += ' ' + typeof logObj[i] === 'string' ? logObj[i] : JSON.stringify(logObj[i]);
            }
          }

          logStream.write(date + '\t' + name + '\t' + level + '\t' + fileNameWithLine + '\t' + message + '\n');
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

    log.debug('warning: planned changes, see https://github.com/homebridge-eufy-security/plugin/issues/1');

    log.debug('plugin data store: ' + this.eufyPath);
    log.debug('OS is', this.hostSystem);
    log.debug('Using bropats @homebridge-eufy-security/eufy-security-client library in version ' + libVersion);

    if (!this.checkNodeVersion()) {
      log.error(`
      ***************************
      ****** ERROR MESSAGE ******
      ***************************
      Error: Your current Node.js version (${version}) is incompatible with the RSA_PKCS1_PADDING used by the plugin. 
      Please downgrade to a compatible version by running the command likes: sudo hb-service update-node 20.11.0.
      Refer to https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js for upgrading/downgrading Node.js
      Refer to https://nodejs.org/en/blog/vulnerability/february-2024-security-releases#nodejs-is-vulnerable-to-the-marvin-attack-timing-variant-of-the-bleichenbacher-attack-against-pkcs1-v15-padding-cve-2023-46809---medium for more information.
      ***************************
      `);
      return;
    }

    this.videoProcessor = ffmpegPath ?? 'ffmpeg';
    log.debug(`ffmpegPath set: ${this.videoProcessor}`);

    this.clean_config();

    log.debug('The config is:', this.config);

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
      logging: {
        level: (this.config.enableDetailedLogging) ? LogLevel.Debug : LogLevel.Info,
      },
    } as EufySecurityConfig;

    this.config.ignoreStations = this.config.ignoreStations ??= [];
    this.config.ignoreDevices = this.config.ignoreDevices ??= [];
    this.config.cleanCache = this.config.cleanCache ??= true;

    log.debug(`Country set: ${this.eufyConfig.country}`);

    // This function is here to avoid any break while moving from 1.0.x to 1.1.x
    // moving persistent into our dedicated folder (this need to be removed after few release of 1.1.x)
    if (fs.existsSync(this.api.user.storagePath() + '/persistent.json')) {
      log.debug('An old persistent file have been found');
      if (!fs.existsSync(this.eufyPath + '/persistent.json')) {
        fs.copyFileSync(this.api.user.storagePath() + '/persistent.json', this.eufyPath + '/persistent.json', fs.constants.COPYFILE_EXCL);
      } else {
        log.debug('but the new one is already present');
      }
      fs.unlinkSync(this.api.user.storagePath() + '/persistent.json');
    }
    // ********

    this.api.on(APIEvent.DID_FINISH_LAUNCHING, async () => {
      this.clean_config_after_init();
      await this.pluginSetup();
    });
    this.api.on(APIEvent.SHUTDOWN, async () => {
      await this.pluginShutdown();
    });

    log.debug('Finished booting!');
  }

  private async pluginSetup() {

    try {
      this.eufyClient = await EufySecurity.initialize(
        this.eufyConfig,
        (this.config.enableDetailedLogging) ? tsLogger : undefined
      );

      this.eufyClient.on('station added', this.stationAdded.bind(this));
      this.eufyClient.on('station removed', this.stationRemoved.bind(this));
      this.eufyClient.on('device added', this.deviceAdded.bind(this));
      this.eufyClient.on('device removed', this.deviceRemoved.bind(this));

      this.eufyClient.on('push connect', () => {
        log.debug('Push Connected!');
      });
      this.eufyClient.on('push close', () => {
        log.debug('Push Closed!');
      });
      this.eufyClient.on('connect', () => {
        log.debug('Connected!');
      });
      this.eufyClient.on('close', () => {
        log.debug('Closed!');
      });
      this.eufyClient.on('connection error', async (error: Error) => {
        log.debug(`Error: ${error}`);
        await this.pluginShutdown();
      });
      this.eufyClient.once('captcha request', async () => {
        log.error(`
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
        log.error(`
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
      log.error(`Error while setup : ${e}`);
      log.error('Not connected can\'t continue!');
      return;
    }

    try {
      await this.eufyClient.connect();
      log.debug('EufyClient connected ' + this.eufyClient.isConnected());
    } catch (e) {
      log.error(`Error authenticating Eufy: ${e}`);
    }

    if (!this.eufyClient.isConnected()) {
      log.error('Not connected can\'t continue!');
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
      log.warn('Your maximum livestream duration value is too large. Since this can cause problems it was reset to 86400 seconds (1 day maximum).');
    }

    this.eufyClient.setCameraMaxLivestreamDuration(cameraMaxLivestreamDuration);
    log.debug(`CameraMaxLivestreamDuration: ${this.eufyClient.getCameraMaxLivestreamDuration()}`);
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

      if (cachedAccessory) {
        this.accessories.splice(this.accessories.indexOf(cachedAccessory), 1); // Remove from the accessories array
      }

      const accessory = cachedAccessory || new this.api.platformAccessory(deviceContainer.deviceIdentifier.displayName, uuid);
      accessory.context['device'] = deviceContainer.deviceIdentifier;


      if (isStation) {
        this.register_station(accessory, deviceContainer as StationContainer);
      } else {
        this.register_device(accessory, deviceContainer as DeviceContainer);
      }

      if (cachedAccessory) {
        this.api.updatePlatformAccessories([accessory]);
        log.info(`Updating existing accessory: ${accessory.displayName}`);
      } else {
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        log.info(`Registering new accessory: ${accessory.displayName}`);
      }
    } catch (error) {
      log.error(`Error in ${isStation ? 'stationAdded' : 'deviceAdded'}: ${error}`);
    }
  }

  private async stationAdded(station: Station) {
    try {

      if (this.config.ignoreStations.includes(station.getSerial())) {
        log.debug(`${station.getName()}: Station ignored`);
        return;
      }

      const rawStation = station.getRawStation();
      if (rawStation.member.member_type !== UserType.ADMIN) {
        await this.pluginShutdown();
        log.error(`
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
      log.debug(`${deviceContainer.deviceIdentifier.displayName} pre-caching complete`);

      this.addOrUpdateAccessory(deviceContainer, true);
    } catch (error) {
      log.error(`Error in stationAdded:, ${error}`);
    }
  }

  private async deviceAdded(device: Device) {
    try {
      if (this.config.ignoreDevices.includes(device.getSerial())) {
        log.debug(`${device.getName()}: Device ignored`);
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
      log.debug(`${deviceContainer.deviceIdentifier.displayName} pre-caching complete`);

      this.addOrUpdateAccessory(deviceContainer, false);
    } catch (error) {
      log.error(`Error in deviceAdded: ${error}`);
    }
  }

  private async stationRemoved(station: Station) {
    const serial = station.getSerial();
    log.debug(`A device has been removed: ${serial}`);
  }

  private async deviceRemoved(device: Device) {
    const serial = device.getSerial();
    log.debug(`A device has been removed: ${serial}`);
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

    try {
      if (this.eufyClient.isConnected()) {
        this.eufyClient.close();
      }
      log.info('Finished shutdown!');
    } catch (e) {
      log.error(`Error while shutdown: ${e}`);
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    log.debug(`Loading accessory from cache: ${accessory.displayName}`);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  private cleanCachedAccessories() {
    if (this.config.cleanCache) {
      log.debug('Looking for old cached accessories that seem to be outdated...');
      let num = 0;

      const staleAccessories = this.accessories.filter((item) => {
        return this.activeAccessoryIds.indexOf(item.UUID) === -1;
      });

      staleAccessories.forEach((staleAccessory) => {
        log.info(`Removing cached accessory ${staleAccessory.UUID} ${staleAccessory.displayName}`);
        num++;
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [staleAccessory]);
      });

      if (num > 0) {
        log.info('Removed ' + num + ' cached accessories');
      } else {
        log.info('No outdated cached accessories found.');
      }
    }
  }

  private register_station(
    accessory: PlatformAccessory,
    container: StationContainer,
  ): void {

    log.debug(accessory.displayName + ' UUID:' + accessory.UUID);

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
        log.warn(`${accessory.displayName} looks station but it's not could imply some errors! Type: ${type}`);
        return;
      }
    }

    if (this.config.autoSyncStation) {
      new AutoSyncStationAccessory(this, accessory, station as Station);
    } else {
      new StationAccessory(this, accessory, station as Station);
    }
  }

  private register_device(
    accessory: PlatformAccessory,
    container: DeviceContainer,
  ): void {

    log.debug(accessory.displayName + ' UUID:' + accessory.UUID);
    const device = container.eufyDevice;

    if (device.isMotionSensor()) {
      log.debug(accessory.displayName + ' isMotionSensor!');
      new MotionSensorAccessory(this, accessory, device as MotionSensor);
    }

    if (device.isEntrySensor()) {
      log.debug(accessory.displayName + ' isEntrySensor!');
      new EntrySensorAccessory(this, accessory, device as EntrySensor);
    }

    if (device.isLock()) {
      log.debug(accessory.displayName + ' isLock!');
      new LockAccessory(this, accessory, device as Lock);
    }

    if (device.isCamera()) {
      log.debug(accessory.displayName + ' isCamera!');
      new CameraAccessory(this, accessory, device as Camera);
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
      log.error('Error cleaning config: ' + e);
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
            log.warn('Found camera ' + cachedAccessory.context['device'].displayName + ' (' + cachedAccessory.context['device'].uniqueId + ') with invalid camera configuration option enableCamera. Attempt to repair. This should only happen once per device...');
            pluginConfig.cameras[i]['enableCamera'] = true;
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
      log.error('Error cleaning config: ' + e);
    }
  }

  /**
   * Reads a file synchronously and returns its buffer.
   * Also lists the contents of the current directory.
   * @param filepath - The path to the file to read.
   * @returns The file buffer.
   * @throws An error if the file cannot be read.
   */
  private readFileSync(filepath: string): Buffer {
    try {
      filepath = __dirname + filepath;
      // Read and return the file buffer
      return fs.readFileSync(filepath);
    } catch (error) {
      throw new Error(`We could not cache ${filepath} file for further use: ${error}`);
    }
  }

  private compareVersions(versionA: string, versionB: string): number {
    const partsA = versionA.split('.').map(Number);
    const partsB = versionB.split('.').map(Number);

    // Compare major versions
    if (
      partsA[0] !== partsB[0]
    ) {
      return -1;
    }

    // Compare patch version
    return partsA[2] - partsB[2];
  }

  private checkNodeVersion(): boolean {
    const nodeVersion = version.slice(1); // Removing 'v' from the version string

    // Versions known to break compatibility with RSA_PKCS1_PADDING
    const incompatibleVersions = [
      '18.19.1',
      '20.11.1',
      '21.6.2'
    ];

    for (const incompatibleVersion of incompatibleVersions) {
      if (this.compareVersions(nodeVersion, incompatibleVersion) >= 0) {
        return false;
      }
    }

    return true;
  }

}