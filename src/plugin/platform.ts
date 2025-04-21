/* eslint @typescript-eslint/no-var-requires: "off" */
import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  APIEvent,
} from 'homebridge';

import { DEVICE_INIT_DELAY, PLATFORM_NAME, PLUGIN_NAME, STATION_INIT_DELAY } from './settings';

import { DEFAULT_CONFIG_VALUES, EufySecurityPlatformConfig } from './config';

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
} from 'eufy-security-client';

import { ILogObjMeta } from 'tslog';
import { createStream } from 'rotating-file-stream';

import fs from 'fs';

import os from 'node:os';
import { platform } from 'node:process';
import { readFileSync } from 'node:fs';

import { init_log, log, tsLogger, ffmpegLogger, HAP } from './utils/utils';
import { LIB_VERSION } from './version';

export class EufySecurityPlatform implements DynamicPlatformPlugin {
  public eufyClient: EufySecurity = {} as EufySecurity;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  private already_shutdown: boolean = false;

  public readonly eufyPath: string;

  private activeAccessoryIds: string[] = [];
  private cleanCachedAccessoriesTimeout?: NodeJS.Timeout;

  private _hostSystem: string = '';

  constructor(
    hblog: Logger,
    public config: EufySecurityPlatformConfig,
    public readonly api: API,
  ) {

    this.eufyPath = this.api.user.storagePath() + '/eufysecurity';

    if (!fs.existsSync(this.eufyPath)) {
      fs.mkdirSync(this.eufyPath);
    }

    // Identify what we're running on so we can take advantage of hardware-specific features.
    this.probeHwOs();

    this.initConfig(config);

    this.configureLogger();

    this.initSetup();
  }

  /**
   * Initializes the configuration object with default values where properties are not provided.
   * If a property is provided in the config object, it overrides the default value.
   * Additionally, certain numeric properties are parsed to ensure they are of the correct type.
   * @param config - Partial configuration object with user-provided values.
   */
  private initConfig(config: Partial<EufySecurityPlatformConfig>): void {
    // Assigns the provided config object to this.config, casting it to the EufySecurityPlatformConfig type.
    this.config = config as EufySecurityPlatformConfig;

    // Iterates over each key in the DEFAULT_CONFIG_VALUES object.
    Object.keys(DEFAULT_CONFIG_VALUES).forEach(key => {
      // Checks if the corresponding property in the config object is undefined or null.
      // If it is, assigns the default value from DEFAULT_CONFIG_VALUES to it.
      this.config[key] ??= DEFAULT_CONFIG_VALUES[key];
    });

    // List of properties that need to be parsed as numeric values
    const numericProperties: (keyof EufySecurityPlatformConfig)[] = [
      'CameraMaxLivestreamDuration',
      'pollingIntervalMinutes',
      'hkHome',
      'hkAway',
      'hkNight',
      'hkOff'
    ];

    // Iterate over each property in the config object
    Object.entries(this.config).forEach(([key, value]) => {
      // Check if the property is one of the numeric properties
      if (numericProperties.includes(key)) {
        // Parse the value to ensure it is of the correct type (number)
        this.config[key] = (typeof value === 'string') ? parseInt(value as string) : value;
      }
    });
  }

  /**
   * Configures the logging mechanism for the plugin.
   */
  private configureLogger() {
    // Define options for logging
    const logOptions = {
      name: '[EufySecurity]', // Name prefix for log messages
      prettyLogTemplate: '[{{mm}}/{{dd}}/{{yyyy}}, {{hh}}:{{MM}}:{{ss}}]\t{{name}}\t{{logLevelName}}\t', // Template for pretty log output
      prettyErrorTemplate: '\n{{errorName}} {{errorMessage}}\nerror stack:\n{{errorStack}}', // Template for pretty error output
      prettyErrorStackTemplate: '  • {{fileName}}\t{{method}}\n\t{{fileNameWithLine}}', // Template for error stack trace
      prettyErrorParentNamesSeparator: '', // Separator for parent names in error messages
      prettyErrorLoggerNameDelimiter: '\t', // Delimiter for logger name in error messages
      stylePrettyLogs: true, // Enable styling for logs
      minLevel: 3, // Minimum log level to display (3 corresponds to INFO)
      prettyLogTimeZone: 'local' as 'local' | 'local', // Time zone for log timestamps
      prettyLogStyles: { // Styles for different log elements
        logLevelName: { // Styles for log level names
          '*': ['bold', 'black', 'bgWhiteBright', 'dim'], // Default style
          SILLY: ['bold', 'white'], // Style for SILLY level
          TRACE: ['bold', 'whiteBright'], // Style for TRACE level
          DEBUG: ['bold', 'green'], // Style for DEBUG level
          INFO: ['bold', 'blue'], // Style for INFO level
          WARN: ['bold', 'yellow'], // Style for WARN level
          ERROR: ['bold', 'red'], // Style for ERROR level
          FATAL: ['bold', 'redBright'], // Style for FATAL level
        },
        dateIsoStr: 'gray', // Style for ISO date strings
        filePathWithLine: 'white', // Style for file paths with line numbers
        name: 'green', // Style for logger names
        nameWithDelimiterPrefix: ['white', 'bold'], // Style for logger names with delimiter prefix
        nameWithDelimiterSuffix: ['white', 'bold'], // Style for logger names with delimiter suffix
        errorName: ['bold', 'bgRedBright', 'whiteBright'], // Style for error names
        fileName: ['yellow'], // Style for file names
      },
      maskValuesOfKeys: [ // Keys whose values should be masked in logs
        'username',
        'password',
        'token',
        'clientPrivateKey',
        'private_key',
        'login_hash',
        'serverPublicKey',
        'cloud_token',
        'refreshToken',
        'p2p_conn',
        'app_conn',
        'address',
        'latitude',
        'longitude',
        'serialnumber',
        'serialNumber',
        'stationSerialNumber',
        'data',
        'ignoreStations',
        'ignoreDevices',
        'pincode',
      ],
    };

    // Modify log options if detailed logging is enabled
    if (this.config.enableDetailedLogging) {
      logOptions.name = `[EufySecurity-${LIB_VERSION}]`; // Modify logger name with plugin version
      logOptions.prettyLogTemplate = '[{{mm}}/{{dd}}/{{yyyy}} {{hh}}:{{MM}}:{{ss}}]\t{{name}}\t{{logLevelName}}\t[{{fileNameWithLine}}]\t'; // Modify log template
      logOptions.minLevel = 2; // Adjust minimum log level
    }

    // Initialize the global logger with the configured options
    init_log(logOptions);

    // Configures log streams for various log files
    this.configureLogStreams();
  }

  /**
  * Configures log streams for various log files if log file storage is not omitted.
  */
  private configureLogStreams() {

    // Log a message if log file storage will be omitted
    if (this.config.omitLogFiles) {
      log.info('log file storage will be omitted.');
      return;
    }

    // Log streams configuration
    const logStreams = [
      { name: 'eufy-security.log', logger: log },
      { name: 'ffmpeg.log', logger: ffmpegLogger },
      { name: 'eufy-lib.log', logger: tsLogger },
    ];

    // Iterate over log streams
    for (const { name, logger } of logStreams) {
      // Create a log stream with specific configurations
      const logStream = createStream(name, {
        path: this.eufyPath, // Log file path
        interval: '1d', // Log rotation interval (1 day)
        rotate: 3, // Number of rotated log files to keep
        maxSize: '200M', // Maximum log file size
      });

      // Attach a transport function to write log messages to the log stream
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

        // Write formatted log message to the log stream
        logStream.write(date + '\t' + name + '\t' + level + '\t' + fileNameWithLine + '\t' + message + '\n');
      });
    }
  }

  // This function is responsible for identifying the hardware and operating system environment the application is running on.
  private probeHwOs(): void {

    // Start off with a generic identifier.
    this._hostSystem = 'generic';

    // Take a look at the platform we're on for an initial hint of what we are.
    switch (platform) {

      // The beloved macOS.
      case 'darwin':

        // For macOS, we check the CPU model to determine if it's an Apple CPU or an Intel CPU.
        this._hostSystem = 'macOS.' + (os.cpus()[0].model.includes('Apple') ? 'Apple' : 'Intel');

        break;

      // The indomitable Linux.
      case 'linux':

        // Let's further see if we're a small, but scrappy, Raspberry Pi.
        try {

          // As of the 4.9 kernel, Raspberry Pi prefers to be identified using this method and has deprecated cpuinfo.
          const systemId = readFileSync('/sys/firmware/devicetree/base/model', { encoding: 'utf8' });

          // Check if it's a Raspberry Pi 4.
          if (/Raspberry Pi (Compute Module )?4/.test(systemId)) {

            // If it's a Pi 4, we identify the system as running Raspbian.
            this._hostSystem = 'raspbian';
          }
        } catch {

          // Errors encountered while attempting to identify the system are ignored.
          // We prioritize getting system information through hints rather than comprehensive detection.
        }

        break;

      default:

        // We aren't trying to solve for every system type.
        // If the platform doesn't match macOS or Linux, we keep the generic identifier.
        break;
    }
  }

  // Utility to return the hardware environment we're on.
  public get hostSystem(): string {
    return this._hostSystem;
  }

  private initSetup() {

    log.debug('warning: planned changes, see https://github.com/homebridge-eufy-security/plugin/issues/1');

    log.debug('plugin data store:', this.eufyPath);
    log.debug('OS is', this.hostSystem);
    log.debug('Using bropats @homebridge-eufy-security/eufy-security-client library in version ', libVersion);

    // Log the final configuration object for debugging purposes
    log.debug('The config is:', this.config);

    const eufyConfig = {
      username: this.config.username,
      password: this.config.password,
      country: this.config.country,
      trustedDeviceName: this.config.deviceName,
      language: 'en',
      persistentDir: this.eufyPath,
      p2pConnectionSetup: 0,
      pollingIntervalMinutes: this.config.pollingIntervalMinutes,
      enableEmbeddedPKCS1Support:  this.config.enableEmbeddedPKCS1Support,
      eventDurationSeconds: 10,
      logging: {
        level: (this.config.enableDetailedLogging) ? LogLevel.Debug : LogLevel.Info,
      },
    } as EufySecurityConfig;

    this.api.on(APIEvent.DID_FINISH_LAUNCHING, async () => {
      await this.pluginSetup(eufyConfig);
    });

    this.api.on(APIEvent.SHUTDOWN, async () => {
      await this.pluginShutdown();
    });

    log.debug('Finished booting!');
  }

  private async pluginSetup(eufyConfig: EufySecurityConfig) {

    try {
      this.eufyClient = await EufySecurity.initialize(
        eufyConfig,
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

    if (this.config.CameraMaxLivestreamDuration > 86400) {
      this.config.CameraMaxLivestreamDuration = 86400;
      log.warn('Your maximum livestream duration value is too large. Since this can cause problems it was reset to 86400 seconds (1 day maximum).');
    }

    this.eufyClient.setCameraMaxLivestreamDuration(this.config.CameraMaxLivestreamDuration);
    log.debug(`CameraMaxLivestreamDuration: ${this.eufyClient.getCameraMaxLivestreamDuration()}`);
  }

  /**
   * Generates a UUID based on the given identifier and station flag.
   * @param identifier The unique identifier.
   * @param isStation Flag indicating whether the identifier belongs to a station.
   * @returns The generated UUID.
   */
  private generateUUID(identifier: string, isStation: boolean): string {
    // Add prefix 's_' if it's a station identifier, otherwise, no prefix.
    const prefix = isStation ? 's1_' : 'd1_';
    // Generate UUID based on the prefix + identifier.
    return HAP.uuid.generate(prefix + identifier);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Defines an accessory for a device or station.
   * 
   * @param deviceContainer The container holding information about the device or station.
   * @param isStation A boolean indicating whether the container represents a station.
   * @returns A tuple containing the created or cached accessory and a boolean indicating whether the accessory was cached.
   */
  private defineAccessory(deviceContainer: StationContainer | DeviceContainer, isStation: boolean): [PlatformAccessory, boolean] {
    // Generate UUID for the accessory based on device's unique identifier and whether it's a station
    const uuid = this.generateUUID(deviceContainer.deviceIdentifier.uniqueId, isStation);

    // Check if the accessory is already cached
    const cachedAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    // If the accessory is cached, remove it from the accessories array
    if (cachedAccessory) {
      this.accessories.splice(this.accessories.indexOf(cachedAccessory), 1);
    }

    // Determine if the device is a camera
    const isCamera: boolean = (deviceContainer.eufyDevice instanceof Device)
      ? deviceContainer.eufyDevice.isCamera()
      : false;

    // Create a new accessory if not cached, otherwise use the cached one
    const accessory = cachedAccessory
      || new this.api.platformAccessory(
        deviceContainer.deviceIdentifier.displayName,
        uuid,
        isCamera ? HAP.Categories.CAMERA : HAP.Categories.SECURITY_SYSTEM,
      );

    // Store device information in accessory context
    accessory.context['device'] = deviceContainer.deviceIdentifier;
    accessory.displayName = deviceContainer.deviceIdentifier.displayName;

    return [accessory, !!cachedAccessory];
  }

  /**
   * Adds or updates an accessory for a device or station.
   * 
   * @param deviceContainer The container holding information about the device or station.
   * @param isStation A boolean indicating whether the container represents a station.
   */
  private async addOrUpdateAccessory(deviceContainer: StationContainer | DeviceContainer, isStation: boolean) {
    try {
      // Define the accessory and check if it already exists
      const [accessory, isExist] = this.defineAccessory(deviceContainer, isStation);

      // Register the accessory based on whether it's a station or device
      try {
        if (isStation) {
          this.register_station(accessory, deviceContainer as StationContainer);
        } else {
          this.register_device(accessory, deviceContainer as DeviceContainer);
        }
      } catch (error) {
        // Remove station or device accessories created prior to plugin upgrade,
        // which may have been subject to removal due to newly introduced logic.
        if (isExist) {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
        throw error;
      }

      // Add the accessory's UUID to activeAccessoryIds if it's not already present
      if (this.activeAccessoryIds.indexOf(accessory.UUID) === -1) {
        this.activeAccessoryIds.push(accessory.UUID);
      }

      // Update or register the accessory with the platform
      if (isExist) {
        this.api.updatePlatformAccessories([accessory]);
        log.info(`Updating existing accessory: ${accessory.displayName}`);
      } else {
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        log.info(`Registering new accessory: ${accessory.displayName}`);
      }
    } catch (error) {
      // Log any errors that occur during accessory addition or update
      log.error(`Error in ${isStation ? 'stationAdded' : 'deviceAdded'}:`, error);
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
          displayName: 'STATION ' + station.getName().replace(/[^a-zA-Z0-9]/g, ''),
          type: station.getDeviceType(),
        } as DeviceIdentifier,
        eufyDevice: station,
      };

      await this.delay(STATION_INIT_DELAY);
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

      // Check if the device is a keypad and ignore it from the start
      const deviceType = device.getDeviceType();
      if (Device.isKeyPad(deviceType)) {
        log.warn(`${device.getName()}: The keypad is ignored as it serves no purpose in this plugin. You can ignore this message.`);
        return;
      }

      const deviceContainer: DeviceContainer = {
        deviceIdentifier: {
          uniqueId: device.getSerial(),
          displayName: 'DEVICE ' + device.getName().replace(/[^a-zA-Z0-9]/g, ''),
          type: deviceType,
        } as DeviceIdentifier,
        eufyDevice: device,
      };

      await this.delay(DEVICE_INIT_DELAY);
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
      // Standalone Lock or Doorbell doesn't have Security Control
      if (Device.isDoorbell(type) || Device.isLock(type)) {
        throw new Error(`looks station but it's not could imply some errors! Type: ${type}. You can ignore this message.`);
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
    const type = container.deviceIdentifier.type;

    if (Device.isMotionSensor(type)) {
      log.debug(accessory.displayName + ' isMotionSensor!');
      new MotionSensorAccessory(this, accessory, device as MotionSensor);
    }

    if (Device.isEntrySensor(type)) {
      log.debug(accessory.displayName + ' isEntrySensor!');
      new EntrySensorAccessory(this, accessory, device as EntrySensor);
    }

    if (Device.isLock(type)) {
      log.debug(accessory.displayName + ' isLock!');
      new LockAccessory(this, accessory, device as Lock);
    }

    if (Device.isCamera(type)) {
      log.debug(accessory.displayName + ' isCamera!');
      new CameraAccessory(this, accessory, device as Camera);
    }

  }

}