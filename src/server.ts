import { EufySecurity, EufySecurityConfig, libVersion, Device, Station, PropertyName, CommandName, DeviceType, UserType } from 'eufy-security-client';
import * as fs from 'fs';
import { Logger as TsLogger, ILogObj } from 'tslog';
import { createStream } from 'rotating-file-stream';
import { Zip } from 'zip-lib';
import { Accessory, L_Station, L_Device, LoginResult, LoginFailReason } from './configui/app/util/types.js';
import { LIB_VERSION } from './version.js';
import path from 'path';

class UiServer {
  public stations: L_Station[] = [];

  private eufyClient: EufySecurity | null = null;
  private log!: TsLogger<ILogObj>;
  private tsLog!: TsLogger<ILogObj>;
  private homebridgeStoragePath: string;
  private storagePath: string;
  private storedAccessories_file: string;
  private logZipFilePath: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pushEvent: (event: string, data: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onRequest: (path: string, callback: (data?: any) => Promise<any>) => void;
  private ready: () => void;

  private adminAccountUsed: boolean = false;

  public config: EufySecurityConfig = {
    username: '',
    password: '',
    language: 'en',
    country: 'US',
    trustedDeviceName: 'My Phone',
    persistentDir: '',
    p2pConnectionSetup: 0,
    pollingIntervalMinutes: 99,
    eventDurationSeconds: 10,
    acceptInvitations: true,
  } as EufySecurityConfig;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(server: any) {
    // Copy over properties from the HomebridgePluginUiServer instance
    this.homebridgeStoragePath = server.homebridgeStoragePath;
    this.pushEvent = server.pushEvent.bind(server);
    this.onRequest = server.onRequest.bind(server);
    this.ready = server.ready.bind(server);

    // Initialize paths now that we have homebridgeStoragePath
    this.storagePath = this.homebridgeStoragePath + '/eufysecurity';
    this.storedAccessories_file = this.storagePath + '/accessories.json';
    this.logZipFilePath = this.storagePath + '/logs.zip';
    this.config.persistentDir = this.storagePath;

    this.initLogger();
    this.initTransportStreams();
    this.initEventListeners();
    this.ready();
  }

  private initLogger() {
    this.log = new TsLogger({
      name: `[${LIB_VERSION}]`,
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

  /**
   * Deletes a file if it exists.
   * 
   * @param filePath The path to the file to be deleted.
   * @returns A Promise that resolves when the operation is complete, or rejects if an error occurs.
   * @throws Will reject the Promise with the error if file deletion fails.
   */
  private async deleteFileIfExists(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Resets the persistent data by removing the persistent.json file.
   * 
   * @returns A Promise that resolves when the operation is complete, or rejects if an error occurs.
   */
  async resetPersistentData(): Promise<void> {
    return this.deleteFileIfExists(this.storagePath + '/persistent.json');
  }

  /**
   * Resets the accessory data by removing the stored accessories file.
   * 
   * @returns A Promise that resolves when the operation is complete, or rejects if an error occurs.
   */
  async resetAccessoryData(): Promise<void> {
    return this.deleteFileIfExists(this.storedAccessories_file);
  }

  async login(options): Promise<LoginResult> {
    try {
      if (options && options.username && options.password) {
        this.log.info('deleting persistent.json and accessories due to new login');
        this.resetAccessoryData();
        await this.resetPersistentData(); // To be commented for testing purpose
      }
    } catch (error) {
      this.log.error('Could not delete persistent.json due to error: ' + error);
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
        this.eufyClient?.on('station added', await this.addStation.bind(this));
        this.eufyClient?.on('device added', await this.addDevice.bind(this));
        // Close connection after 40 seconds enough time to get all devices
        setTimeout(() => {
          this.eufyClient?.removeAllListeners();
          this.eufyClient?.close();
        }, 40 * 1000);
      } catch (error) {
        this.log.error(error);
      }
    }

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve({ success: false, failReason: LoginFailReason.TIMEOUT });
      }, 25 * 1000);

      if (options && options.username && options.password && options.country) {
        this.log.debug('login with credentials');
        try {
          this.loginHandlers(resolve);
          this.eufyClient?.connect()
            .then(() => this.log.debug('connected?: ' + this.eufyClient?.isConnected()))
            .catch((error) => this.log.error(error));
        } catch (error) {
          this.log.error(error);
          resolve({ success: false, failReason: LoginFailReason.UNKNOWN, data: { error: error } });
        }
      } else if (options && options.verifyCode) {
        try {
          this.loginHandlers(resolve);
          this.eufyClient?.connect({ verifyCode: options.verifyCode, force: false });
        } catch (error) {
          resolve({ success: false, failReason: LoginFailReason.UNKNOWN, data: { error: error } });
        }
      } else if (options && options.captcha) {
        try {
          this.loginHandlers(resolve);
          this.eufyClient?.connect({ captcha: { captchaCode: options.captcha.captchaCode, captchaId: options.captcha.captchaId }, force: false });
        } catch (error) {
          resolve({ success: false, failReason: LoginFailReason.UNKNOWN, data: { error: error } });
        }
      } else {
        reject('unsupported login method');
      }
    });
  }

  loginHandlers(resolveCallback) {
    this.eufyClient?.once('tfa request', () => resolveCallback({ success: false, failReason: LoginFailReason.TFA }));
    this.eufyClient?.once('captcha request', (id, captcha) => resolveCallback({ success: false, failReason: LoginFailReason.CAPTCHA, data: { id: id, captcha: captcha } }));
    this.eufyClient?.once('connect', () => resolveCallback({ success: true }));
  }

  /**
   * Asynchronously loads stored accessories from a file.
   * @returns A promise resolving to an array of accessories.
   */
  async loadStoredAccessories(): Promise<Accessory[]> {
    try {
      // Check if the stored accessories file exists
      if (!fs.existsSync(this.storedAccessories_file)) {
        // If the file doesn't exist, log a warning and return an empty array
        this.log.debug('Stored accessories file does not exist.');
        return [];
      }

      // Read the content of the stored accessories file asynchronously
      const storedData = await fs.promises.readFile(this.storedAccessories_file, { encoding: 'utf-8' });

      // Parse the JSON data obtained from the file
      const { version: storedVersion, stations: storedAccessories } = JSON.parse(storedData);

      // Compare the stored version with the current version
      if (storedVersion !== LIB_VERSION) {
        // If the versions do not match, log a warning and push an event
        this.pushEvent('versionUnmatched', { currentVersion: LIB_VERSION, storedVersion: storedVersion });
        this.log.warn(`Stored version (${storedVersion}) does not match current version (${LIB_VERSION})`);
      }

      // Return the parsed accessories
      return storedAccessories as Accessory[];
    } catch (error) {
      // If an error occurs during the process, log an error message and return an empty array
      this.log.error('Could not get stored accessories. Most likely no stored accessories yet: ' + error);
      return [];
    }
  }

  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async addStation(station: Station) {
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

    await this.delay(1000);

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

  async addDevice(device: Device) {
    // Before doing anything check if creds are guest admin
    if (this.adminAccountUsed) {
      this.pushEvent('AdminAccountUsed', true);
      return;
    }

    await this.delay(2000);

    const d: L_Device = {
      uniqueId: device.getSerial(),
      displayName: device.getName(),
      type: device.getDeviceType(),
      typename: DeviceType[device.getDeviceType()],
      standalone: device.getSerial() === device.getStationSerial(),
      hasBattery: device.hasBattery(),
      isCamera: device.isCamera(),
      isDoorbell: device.isDoorbell(),
      isKeypad: device.isKeyPad(),
      supportsRTSP: device.hasPropertyValue(PropertyName.DeviceRTSPStream),
      supportsTalkback: device.hasCommand(CommandName.DeviceStartTalkback),
      DeviceEnabled: device.hasProperty(PropertyName.DeviceEnabled),
      DeviceMotionDetection: device.hasProperty(PropertyName.DeviceMotionDetection),
      DeviceLight: device.hasProperty(PropertyName.DeviceLight),
      DeviceChimeIndoor: device.hasProperty(PropertyName.DeviceChimeIndoor),
      disabled: false,
      properties: device.getProperties(),
    };

    if (device.hasProperty(PropertyName.DeviceChargingStatus)) {
      d.chargingStatus = (device.getPropertyValue(PropertyName.DeviceChargingStatus) as number);
    }

    try {
      delete d.properties.picture;
    } catch (error) {
      this.log.error(error);
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
    const dataToStore = { version: LIB_VERSION, stations: this.stations };
    fs.writeFileSync(this.storedAccessories_file, JSON.stringify(dataToStore));
  }

  async resetPlugin() {
    try {
      fs.rmSync(this.storagePath, { recursive: true });
      return { result: 1 };
    } catch (error) {
      this.log.error('Could not reset plugin: ' + error);
      return { result: 0 };
    }
  }

  async getLogs(): Promise<string[]> {
    // Step 1: List Files in Directory
    // Asynchronously list all files in the directory specified by this.storagePath.
    const files = await fs.promises.readdir(this.storagePath);

    // Step 2: Filter Log Files
    // Filter the list of files to include only those with names ending in .log, .log.0.
    const logFiles = files.filter(file => {
      return file.endsWith('.log') || file.endsWith('.log.0');
    });

    // Step 3: Filter out Empty Log Files
    const nonEmptyLogFiles = await Promise.all(logFiles.map(async file => {
      const filePath = path.join(this.storagePath, file);
      const stats = await fs.promises.stat(filePath);
      if (stats.size > 0) {
        return file;
      }
      return null;
    }));

    // Step 4: Remove null entries (empty log files) from the array
    return nonEmptyLogFiles.filter(file => file !== null) as string[];
  }

  /**
   * Asynchronously compresses log files from a directory and returns a Promise that resolves to a Buffer.
   * @returns {Promise<Buffer>} A Promise resolving to a Buffer containing compressed log files.
   */
  async downloadLogs(): Promise<Buffer> {

    this.pushEvent('downloadLogsProgress', { progress: 10, status: 'Gets non-empty log files' });
    const finalLogFiles = await this.getLogs();

    // Step 5: Add Log Files to Zip
    // Initialize a Zip instance and add each log file to the archive.
    this.pushEvent('downloadLogsProgress', { progress: 30, status: 'Add Log Files to Zip' });
    const zip = new Zip();
    let numberOfFiles = 0;
    finalLogFiles.forEach(logFile => {
      const filePath = path.join(this.storagePath, logFile);
      zip.addFile(filePath);
      numberOfFiles++;
    });

    // Step 6: Handle No Log Files Found
    // If no log files are found after filtering, throw an error.
    this.pushEvent('downloadLogsProgress', { progress: 40, status: 'No Log Files Found' });
    if (numberOfFiles === 0) {
      throw new Error('No log files were found');
    }

    try {
      // Step 7: Archive Zip
      // Archive the Zip instance to the specified log zip file.
      this.pushEvent('downloadLogsProgress', { progress: 45, status: `Compressing ${numberOfFiles} files` });
      await zip.archive(this.logZipFilePath);

      // Step 8: Read Zip File
      // Read the content of the generated log zip file into a Buffer.
      this.pushEvent('downloadLogsProgress', { progress: 80, status: 'Reading content' });
      const fileBuffer = fs.readFileSync(this.logZipFilePath);

      // Step 9: Return Buffer
      // Return the Buffer containing the compressed log files.
      this.pushEvent('downloadLogsProgress', { progress: 90, status: 'Returning zip file' });
      return fileBuffer;
    } catch (error) {
      // Step 10: Error Handling
      // Log an error if archiving the zip file fails and propagate the error.
      this.log.error('Error while generating log files: ' + error);
      throw error;
    } finally {
      // Step 11: Cleanup
      // Ensure to remove any compressed log files after the operation, regardless of success or failure.
      this.removeCompressedLogs();
    }
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

// Start the instance of the server with dynamic import
(async () => {
  try {
    // Dynamically import the ESM module
    const pluginUiUtils = await import('@homebridge/plugin-ui-utils');
    const HomebridgePluginUiServer = pluginUiUtils.HomebridgePluginUiServer;

    // Create an instance of HomebridgePluginUiServer
    const server = new HomebridgePluginUiServer();

    // Initialize our UiServer with the server instance
    new UiServer(server);
  } catch (error) {
    console.error('Failed to initialize server:', error);
  }
})();