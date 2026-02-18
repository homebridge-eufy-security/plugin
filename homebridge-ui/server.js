import { EufySecurity, libVersion, Device, PropertyName, CommandName, DeviceType, UserType } from 'eufy-security-client';
import * as fs from 'fs';
import { Logger as TsLogger } from 'tslog';
import { createStream } from 'rotating-file-stream';
import { Zip } from 'zip-lib';
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version: LIB_VERSION } = require('../package.json');

/** Max time (ms) to wait for the client to populate raw data on unsupported items. */
const UNSUPPORTED_INTEL_WAIT_MS = 2 * 60 * 1000; // 2 minutes

class UiServer extends HomebridgePluginUiServer {

  stations = [];
  eufyClient = null;
  log;
  tsLog;
  storagePath;
  storedAccessories_file;
  diagnosticsZipFilePath;

  adminAccountUsed = false;

  // Batch processing for stations and devices
  pendingStations = [];
  pendingDevices = [];
  processingTimeout;

  /** Set to true when the user clicks "Skip" in the UI to abort the unsupported intel wait. */
  _skipIntelWait = false;

  /** Current discovery phase — exposed via /discoveryState for UI catch-up. */
  _discoveryPhase = 'idle';

  /** Seconds to wait after the last station/device event before processing. */
  static DISCOVERY_DEBOUNCE_SEC = 15;

  /** Seconds to wait after auth before giving up on device discovery. */
  static DISCOVERY_INACTIVITY_SEC = 30;

  config = {
    username: '',
    password: '',
    language: 'en',
    country: 'US',
    trustedDeviceName: 'My Phone',
    persistentDir: '',
    p2pConnectionSetup: 0,
    pollingIntervalMinutes: 1,
    eventDurationSeconds: 10,
    acceptInvitations: true,
    logging: {
      level: 1, // LogLevel.Debug — enables eufy-security-client internal logging to configui-lib.log
    },
  };

  constructor() {
    super();

    this.storagePath = this.homebridgeStoragePath + '/eufysecurity';
    this.storedAccessories_file = this.storagePath + '/accessories.json';
    this.diagnosticsZipFilePath = null; // generated dynamically with timestamp
    this.config.persistentDir = this.storagePath;

    this.initLogger();
    this.initTransportStreams();
    this.initEventListeners();
    this.ready();
  }

  /**
   * Compute a unified power descriptor from a properties object.
   * Works for both devices and stations.
   * @param {object} props - the properties object (from device.getProperties() or station.getProperties())
   * @returns {{ source: string, icon: string, label: string, battery?: number, batteryLow?: boolean }}
   *   source: 'battery' | 'solar' | 'plugged' | null
   *   icon: icon filename for the UI
   *   label: display text for the UI
   *   battery: percentage (0-100) if available
   *   batteryLow: true/false for simple sensors without percentage
   */
  _computePower(props) {
    const power = { source: null, icon: null, label: null };

    // Battery level
    if (props.battery !== undefined) {
      power.battery = props.battery;
    } else if (props.batteryLow !== undefined) {
      // Simple sensors only expose batteryLow boolean
      power.batteryLow = props.batteryLow;
    }

    // Charging status (bitmask)
    if (props.chargingStatus !== undefined) {
      const cs = props.chargingStatus;
      const isSolar = ((cs >> 2) & 1) === 1;
      const isPlugSolar = ((cs >> 3) & 1) === 1;
      const isUsb = (cs & 1) === 1;

      if (isSolar || isPlugSolar) {
        power.source = 'solar';
        power.icon = 'solar_power.svg';
        power.label = 'Solar Charging';
        return power;
      }
      if (isUsb) {
        power.source = 'plugged';
        power.icon = 'bolt.svg';
        power.label = 'Charging';
        return power;
      }
    }

    // PowerSource property (cameras with battery/solar panel)
    // 0 = BATTERY, 1 = SOLAR_PANEL
    if (props.powerSource === 1) {
      power.source = 'solar';
      power.icon = 'solar_power.svg';
      power.label = 'Solar';
    } else if (props.powerSource === 0) {
      power.source = 'battery';
    } else if (power.battery === undefined && power.batteryLow === undefined) {
      // No battery info at all — AC powered (indoor cameras, stations)
      power.source = 'plugged';
      power.icon = 'bolt.svg';
      power.label = 'Plugged In';
    } else {
      // Has battery/batteryLow but no powerSource — simple battery device (sensors)
      power.source = 'battery';
    }

    return power;
  }

  initLogger() {
    const logOptions = {
      name: `[UI-${LIB_VERSION}]`, // Name prefix for log messages
      prettyLogTemplate: '[{{mm}}/{{dd}}/{{yyyy}}, {{hh}}:{{MM}}:{{ss}}]\t{{name}}\t{{logLevelName}}\t', // Template for pretty log output
      prettyErrorTemplate: '\n{{errorName}} {{errorMessage}}\nerror stack:\n{{errorStack}}', // Template for pretty error output
      prettyErrorStackTemplate: '  • {{fileName}}\t{{method}}\n\t{{fileNameWithLine}}', // Template for error stack trace
      prettyErrorParentNamesSeparator: '', // Separator for parent names in error messages
      prettyErrorLoggerNameDelimiter: '\t', // Delimiter for logger name in error messages
      stylePrettyLogs: true, // Enable styling for logs
      minLevel: 2, // Minimum log level to display (3 corresponds to INFO)
      prettyLogTimeZone: 'local', // Time zone for log timestamps
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
    this.log = new TsLogger(logOptions);
    this.tsLog = new TsLogger({ ...logOptions, type: 'hidden', minLevel: 2 });
  }

  initTransportStreams() {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }

    const logStreams = [
      { name: 'configui-server.log', logger: this.log },
      { name: 'configui-lib.log', logger: this.tsLog },
    ];

    for (const { name, logger } of logStreams) {
      const logStream = createStream(name, { path: this.storagePath, interval: '1d', rotate: 3, maxSize: '200M' });

      logger.attachTransport((logObj) => {
        const meta = logObj['_meta'];
        const logName = meta.name;
        const level = meta.logLevelName;
        const date = meta.date.toISOString();

        let message = '';
        for (let i = 0; i <= 5; i++) {
          if (logObj[i]) {
            message += ' ' + (typeof logObj[i] === 'string' ? logObj[i] : JSON.stringify(logObj[i]));
          }
        }

        logStream.write(date + '\t' + logName + '\t' + level + '\t' + message + '\n');
      });
    }

    this.log.debug('Using bropats eufy-security-client library in version ' + libVersion);
  }

  initEventListeners() {
    this.onRequest('/login', this.login.bind(this));
    this.onRequest('/checkCache', this.checkCache.bind(this));
    this.onRequest('/storedAccessories', this.loadStoredAccessories.bind(this));
    this.onRequest('/reset', this.resetPlugin.bind(this));
    this.onRequest('/downloadDiagnostics', this.downloadDiagnostics.bind(this));
    this.onRequest('/systemInfo', this.getSystemInfo.bind(this));
    this.onRequest('/skipIntelWait', this.skipIntelWait.bind(this));
    this.onRequest('/discoveryState', this.getDiscoveryState.bind(this));
  }

  skipIntelWait() {
    this._skipIntelWait = true;
    this.log.info('User requested to skip unsupported intel wait');
    return { ok: true };
  }

  /**
   * Load valid country codes from the shared countries.js file.
   * Parsed lazily and cached for subsequent calls.
   * @returns {Set<string>}
   */
  _getValidCountryCodes() {
    if (!this._validCountryCodes) {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const source = fs.readFileSync(path.join(__dirname, 'public/utils/countries.js'), 'utf-8');
      this._validCountryCodes = new Set(source.match(/\b[A-Z]{2}(?=\s*:)/g));
    }
    return this._validCountryCodes;
  }

  getDiscoveryState() {
    return {
      phase: this._discoveryPhase,
      progress: this._discoveryPhase === 'queuing' ? 30 : this._discoveryPhase === 'processing' ? 50 : 0,
      stations: this.pendingStations.length,
      devices: this.pendingDevices.length,
      message: this.pendingStations.length > 0 || this.pendingDevices.length > 0
        ? `Discovered ${this.pendingStations.length} station(s), ${this.pendingDevices.length} device(s)...`
        : '',
    };
  }

  async deleteFileIfExists(filePath) {
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async resetPersistentData() {
    return this.deleteFileIfExists(this.storagePath + '/persistent.json');
  }

  async resetAccessoryData() {
    return this.deleteFileIfExists(this.storedAccessories_file);
  }

  async checkCache() {
    const persistentFile = this.storagePath + '/persistent.json';
    try {
      if (fs.existsSync(persistentFile)) {
        const data = JSON.parse(await fs.promises.readFile(persistentFile, 'utf-8'));
        // Basic validity check: ensure it has some expected content
        if (data && Object.keys(data).length > 0) {
          this.log.debug('Persistent cache file found and valid.');
          return { valid: true };
        }
      }
    } catch (error) {
      this.log.warn('Error checking persistent cache: ' + error);
    }
    return { valid: false };
  }

  async login(options) {
    // --- Plugin heartbeat safeguard ---
    // If the plugin is running (accessories.json updated within the last 90s),
    // block login to prevent a competing eufy-security-client instance.
    if (!this.eufyClient) {
      try {
        if (fs.existsSync(this.storedAccessories_file)) {
          const data = JSON.parse(fs.readFileSync(this.storedAccessories_file, 'utf-8'));
          if (data?.storedAt) {
            const ageMs = Date.now() - new Date(data.storedAt).getTime();
            if (ageMs < 90_000) {
              this.log.warn('Plugin heartbeat is fresh — blocking UI login to avoid duplicate eufy client. Please wait 90sec before trying again!');
              this.pushEvent('authError', {
                message: 'The plugin is currently running. Please stop it before logging in from the UI. Please wait 90sec before trying again!',
              });
              return { success: false, pluginRunning: true };
            }
          }
        }
      } catch (error) {
        this.log.debug('Heartbeat check failed (non-blocking): ' + error);
      }
    }

    try {
      if (options && options.username && options.password && !options.reconnect) {
        this.log.info('deleting persistent.json and accessories due to new login');
        await this.resetAccessoryData();
        await this.resetPersistentData();
      } else if (options && options.reconnect) {
        this.log.info('Reconnecting using persistent cache (skipping data reset)');
      }
    } catch (error) {
      this.log.error('Could not delete persistent.json due to error: ' + error);
    }

    if (!this.eufyClient && options && options.username && options.password && options.country) {
      // Clear any pending timeouts from a previous login attempt
      if (this.processingTimeout) {
        clearTimeout(this.processingTimeout);
        this.processingTimeout = null;
      }
      if (this._closeTimeout) {
        clearTimeout(this._closeTimeout);
        this._closeTimeout = null;
      }
      this.stations = [];
      this.pendingStations = [];
      this.pendingDevices = [];
      this._discoveryPhase = 'authenticating';
      this.log.debug('init eufyClient');

      // Validate country code against known list
      const country = typeof options.country === 'string' ? options.country.trim().toUpperCase() : '';
      if (!this._getValidCountryCodes().has(country)) {
        const raw = typeof options.country === 'object' ? JSON.stringify(options.country) : String(options.country);
        this.log.warn(`Invalid country code received: ${raw} — falling back to login.`);
        this.pushEvent('authError', { message: `Invalid country code "${raw}". Please select a valid country and try again.` });
        this._discoveryPhase = 'idle';
        return { success: false };
      }

      this.config.username = options.username;
      this.config.password = options.password;
      this.config.country = country;
      this.config.trustedDeviceName = options.deviceName;
      try {
        this.eufyClient = await EufySecurity.initialize(this.config, this.tsLog);
        this.eufyClient?.on('station added', this.addStation.bind(this));
        this.eufyClient?.on('device added', this.addDevice.bind(this));
        this.eufyClient?.on('push connect', () => this.log.debug('Push Connected!'));
        this.eufyClient?.on('push close', () => this.log.debug('Push Closed!'));
        this.eufyClient?.on('connect', () => this.log.debug('Connected!'));
        this.eufyClient?.on('close', () => this.log.debug('Closed!'));
      } catch (error) {
        this.log.error(error);
        this.pushEvent('authError', { message: `Initialization failed: ${error.message || error}` });
        this._discoveryPhase = 'idle';
        return { success: false };
      }
    }

    // Timeout — fire authError event after 25s if nothing else resolved
    this._loginTimeout = setTimeout(() => {
      this.pushEvent('authError', { message: 'Authentication timed out. Please try again.' });
    }, 25 * 1000);

    if (options && options.username && options.password && options.country) {
      this.log.debug('login with credentials');
      try {
        this._registerAuthHandlers();
        this.eufyClient?.connect()
          .then(() => this.log.debug('connected?: ' + this.eufyClient?.isConnected()))
          .catch((error) => this.log.error(error));
      } catch (error) {
        this.log.error(error);
        clearTimeout(this._loginTimeout);
        this.pushEvent('authError', { message: 'Login error: ' + (error.message || error) });
      }
    } else if (options && options.verifyCode) {
      this.log.debug('login with TFA code');
      this.pushEvent('discoveryProgress', {
        phase: 'authenticating',
        progress: 10,
        message: 'Verifying TFA code...',
      });
      try {
        this._registerAuthHandlers();
        this.eufyClient?.connect({ verifyCode: options.verifyCode, force: false })
          .then(() => this.log.debug('TFA connect resolved, connected?: ' + this.eufyClient?.isConnected()))
          .catch((error) => {
            this.log.error('TFA connect error: ' + error);
            clearTimeout(this._loginTimeout);
            this.pushEvent('authError', { message: 'TFA verification failed: ' + (error.message || error) });
          });
      } catch (error) {
        clearTimeout(this._loginTimeout);
        this.pushEvent('authError', { message: 'TFA verification error: ' + (error.message || error) });
      }
    } else if (options && options.captcha) {
      this.log.debug('login with captcha');
      this.pushEvent('discoveryProgress', {
        phase: 'authenticating',
        progress: 10,
        message: 'Verifying captcha...',
      });
      try {
        this._registerAuthHandlers();
        this.eufyClient?.connect({ captcha: { captchaCode: options.captcha.captchaCode, captchaId: options.captcha.captchaId }, force: false })
          .then(() => this.log.debug('Captcha connect resolved, connected?: ' + this.eufyClient?.isConnected()))
          .catch((error) => {
            this.log.error('Captcha connect error: ' + error);
            clearTimeout(this._loginTimeout);
            this.pushEvent('authError', { message: 'Captcha verification failed: ' + (error.message || error) });
          });
      } catch (error) {
        clearTimeout(this._loginTimeout);
        this.pushEvent('authError', { message: 'Captcha verification error: ' + (error.message || error) });
      }
    } else {
      clearTimeout(this._loginTimeout);
      this.pushEvent('authError', { message: 'Unsupported login method.' });
    }

    // Resolve immediately — all outcomes are delivered via push events
    return { pending: true };
  }

  /**
   * Register one-time auth outcome handlers on the eufy client.
   * All outcomes are delivered to the UI via push events.
   */
  _registerAuthHandlers() {
    this.eufyClient?.once('tfa request', () => {
      clearTimeout(this._loginTimeout);
      this.pushEvent('tfaRequest', {});
    });
    this.eufyClient?.once('captcha request', (id, captcha) => {
      clearTimeout(this._loginTimeout);
      this.pushEvent('captchaRequest', { id, captcha });
    });
    this.eufyClient?.once('connect', () => {
      clearTimeout(this._loginTimeout);
      this.pushEvent('authSuccess', {});
      this.pushEvent('discoveryProgress', {
        phase: 'authenticating',
        progress: 15,
        message: 'Authenticated — waiting for devices...',
      });
      this._startDiscoveryInactivityTimeout();
    });
  }

  /**
   * Start the discovery inactivity timeout.
   * If no station or device is discovered within DISCOVERY_INACTIVITY_SEC seconds
   * after authentication, save the account and send an empty result to the UI.
   */
  _startDiscoveryInactivityTimeout() {
    // If stations or devices were already discovered before connect fired, skip
    if (this.pendingStations.length > 0 || this.pendingDevices.length > 0) {
      this.log.debug('Devices already discovered before connect event — skipping inactivity timeout');
      return;
    }
    this._cancelDiscoveryInactivityTimeout();
    const totalSec = UiServer.DISCOVERY_INACTIVITY_SEC;
    const start = Date.now();

    // Tick every second: progress 15 → 95 during the wait, with countdown
    this._discoveryInactivityTickInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const remaining = Math.max(0, totalSec - elapsed);
      const pct = Math.min(95, 15 + Math.floor((elapsed / totalSec) * 80));
      this.pushEvent('discoveryProgress', {
        phase: 'waitingForDevices',
        progress: pct,
        message: `Authenticated — waiting for devices... ${remaining}s`,
      });
    }, 1000);

    this._discoveryInactivityTimeout = setTimeout(() => {
      clearInterval(this._discoveryInactivityTickInterval);
      this._discoveryInactivityTickInterval = null;
      this.log.warn(
        `No stations or devices discovered within ${totalSec}s after authentication. ` +
        'The account may have no devices or the guest invitation has not been accepted yet.',
      );
      this._discoveryPhase = 'done';
      this.stations = [];
      try {
        this.storeAccessories();
      } catch (error) {
        this.log.error('Error storing empty accessories:', error);
      }
      this.pushEvent('discoveryProgress', {
        phase: 'done',
        progress: 100,
        message: 'No devices found.',
      });
      this.pushEvent('addAccessory', { stations: [], noDevices: true });
      this.eufyClient?.removeAllListeners();
      this.eufyClient?.close();
    }, totalSec * 1000);
  }

  /**
   * Cancel the discovery inactivity timeout (called when a station or device is discovered).
   */
  _cancelDiscoveryInactivityTimeout() {
    if (this._discoveryInactivityTickInterval) {
      clearInterval(this._discoveryInactivityTickInterval);
      this._discoveryInactivityTickInterval = null;
    }
    if (this._discoveryInactivityTimeout) {
      clearTimeout(this._discoveryInactivityTimeout);
      this._discoveryInactivityTimeout = null;
    }
  }

  /**
   * Parse a semver string into [major, minor, patch].
   * @param {string} ver - e.g. '4.4.2-beta.18'
   * @returns {number[]}
   */
  _parseSemver(ver) {
    return (ver || '0.0.0').replace(/-.*$/, '').split('.').map(Number);
  }

  async loadStoredAccessories() {
    try {
      if (!fs.existsSync(this.storedAccessories_file)) {
        this.log.debug('Stored accessories file does not exist.');
        return [];
      }

      const storedData = await fs.promises.readFile(this.storedAccessories_file, { encoding: 'utf-8' });
      const { version: storedVersion, storedAt, stations: storedAccessories } = JSON.parse(storedData);

      // --- Cache age check (30 days) ---
      if (storedAt) {
        const ageMs = Date.now() - new Date(storedAt).getTime();
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        if (ageDays >= 30) {
          this.pushEvent('cacheWarning', { reason: 'stale', ageDays });
          this.log.warn(`Stored accessories are ${ageDays} days old. User should re-login to refresh.`);
        }
      }

      // --- Version branch check ---
      if (storedVersion && storedVersion !== LIB_VERSION) {
        const [curMajor, curMinor] = this._parseSemver(LIB_VERSION);
        const [stoMajor, stoMinor] = this._parseSemver(storedVersion);

        if (curMajor !== stoMajor || curMinor !== stoMinor) {
          // Different minor (or major) branch → force re-login
          this.pushEvent('cacheWarning', {
            reason: 'versionForce',
            currentVersion: LIB_VERSION,
            storedVersion,
          });
          this.log.warn(`Stored version (${storedVersion}) is on a different branch than current (${LIB_VERSION}). Forcing re-login.`);
          return { stations: [], storedAt: null }; // Return empty to force login flow
        } else {
          // Same minor branch, different patch → soft warning
          this.pushEvent('cacheWarning', {
            reason: 'versionWarn',
            currentVersion: LIB_VERSION,
            storedVersion,
          });
          this.log.warn(`Stored version (${storedVersion}) differs from current (${LIB_VERSION}) but same branch. Consider re-login.`);
        }
      }

      return { stations: storedAccessories, storedAt: storedAt || null };
    } catch (error) {
      this.log.error('Could not get stored accessories. Most likely no stored accessories yet: ' + error);
      return { stations: [], storedAt: null };
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async addStation(station) {
    // Check if creds are guest admin
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
      https://github.com/homebridge-plugins/homebridge-eufy-security/wiki/Create-a-dedicated-admin-account-for-Homebridge-Eufy-Security-Plugin
      #########################
      `);
      return;
    }

    this._cancelDiscoveryInactivityTimeout();
    this.pendingStations.push(station);
    this.log.debug(`${station.getName()}: Station queued for processing`);
    this._discoveryPhase = 'queuing';
    this.pushEvent('discoveryProgress', {
      phase: 'queuing',
      progress: 30,
      stations: this.pendingStations.length,
      devices: this.pendingDevices.length,
      message: `Discovered ${this.pendingStations.length} station(s), ${this.pendingDevices.length} device(s)...`,
    });
    this.resetDiscoveryDebounce();
  }

  async addDevice(device) {
    if (this.adminAccountUsed) {
      this.pushEvent('AdminAccountUsed', true);
      return;
    }

    const deviceType = device.getDeviceType();
    if (Device.isKeyPad(deviceType)) {
      this.log.warn(`${device.getName()}: The keypad is ignored as it serves no purpose in this plugin. You can ignore this message.`);
      return;
    }

    this._cancelDiscoveryInactivityTimeout();
    this.pendingDevices.push(device);
    this.log.debug(`${device.getName()}: Device queued for processing`);
    this._discoveryPhase = 'queuing';
    this.pushEvent('discoveryProgress', {
      phase: 'queuing',
      progress: 30,
      stations: this.pendingStations.length,
      devices: this.pendingDevices.length,
      message: `Discovered ${this.pendingStations.length} station(s), ${this.pendingDevices.length} device(s)...`,
    });
    this.resetDiscoveryDebounce();
  }

  /**
   * Resets the discovery debounce timer.
   * Each time a station or device is emitted, the timer restarts.
   * Processing begins once no new events arrive for DISCOVERY_DEBOUNCE_SEC seconds.
   */
  resetDiscoveryDebounce() {
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
    }
    if (this._closeTimeout) {
      clearTimeout(this._closeTimeout);
    }
    if (this._debounceTickInterval) {
      clearInterval(this._debounceTickInterval);
    }
    const delaySec = UiServer.DISCOVERY_DEBOUNCE_SEC;
    this.log.debug(
      `Discovery debounce reset — will process in ${delaySec}s if no more devices arrive ` +
      `(${this.pendingStations.length} station(s), ${this.pendingDevices.length} device(s) queued)`,
    );

    // Tick progress from 30 → 95 during the debounce wait
    const debounceStart = Date.now();
    this._debounceTickInterval = setInterval(() => {
      const elapsed = (Date.now() - debounceStart) / 1000;
      const pct = Math.min(95, 30 + Math.floor((elapsed / delaySec) * 65));
      const remaining = Math.max(0, Math.ceil(delaySec - elapsed));
      this.pushEvent('discoveryProgress', {
        phase: 'queuing',
        progress: pct,
        stations: this.pendingStations.length,
        devices: this.pendingDevices.length,
        message: `Discovered ${this.pendingStations.length} station(s), ${this.pendingDevices.length} device(s) — waiting for more... ${remaining}s`,
      });
    }, 1000);

    this.processingTimeout = setTimeout(() => {
      clearInterval(this._debounceTickInterval);
      this._debounceTickInterval = null;
      this.processPendingAccessories().catch(error => this.log.error('Error processing pending accessories:', error));
    }, delaySec * 1000);
    // Close connection after processing + potential 2-min unsupported intel wait
    const closeAfterSec = delaySec + (UNSUPPORTED_INTEL_WAIT_MS / 1000) + 15;
    this._closeTimeout = setTimeout(() => {
      this.eufyClient?.removeAllListeners();
      this.eufyClient?.close();
    }, closeAfterSec * 1000);
  }

  async processPendingAccessories() {
    this.log.debug(`Processing ${this.pendingStations.length} stations and ${this.pendingDevices.length} devices`);

    this._discoveryPhase = 'processing';
    this.pushEvent('discoveryProgress', {
      phase: 'processing',
      progress: 95,
      stations: this.pendingStations.length,
      devices: this.pendingDevices.length,
      message: `Processing ${this.pendingStations.length} station(s) and ${this.pendingDevices.length} device(s)...`,
    });

    if (this.pendingStations.length === 0 || this.pendingDevices.length === 0) {
      this.log.warn(
        `Discovery finished with ${this.pendingStations.length} station(s) and ${this.pendingDevices.length} device(s). ` +
        'If this is unexpected, please verify your Eufy account has devices and the credentials used are for a guest admin account.',
      );
    }

    // --- Collect unsupported items (stations + devices) upfront ---
    // Hub/base stations (type 0, HB3, etc.) are not in DeviceProperties so
    // Device.isSupported() returns false for them — exclude known station types.
    const unsupportedItems = [];

    for (const station of this.pendingStations) {
      try {
        const st = station.getDeviceType();
        if (!Device.isStation(st) && !Device.isSupported(st)) unsupportedItems.push(station);
      } catch (e) { /* ignore */ }
    }
    for (const device of this.pendingDevices) {
      try {
        if (!Device.isSupported(device.getDeviceType())) unsupportedItems.push(device);
      } catch (e) { /* ignore */ }
    }

    // If unsupported items exist, notify UI and wait (user can skip via /skipIntelWait)
    if (unsupportedItems.length > 0) {
      const names = unsupportedItems.map(i => `${i.getName()} (type ${i.getDeviceType()})`).join(', ');
      this._skipIntelWait = false;

      this.pushEvent('discoveryWarning', {
        unsupportedCount: unsupportedItems.length,
        unsupportedNames: names,
        waitSeconds: UNSUPPORTED_INTEL_WAIT_MS / 1000,
        message: `${unsupportedItems.length} unsupported device(s) detected: ${names}`,
      });

      this.log.info(`Unsupported intel: waiting up to ${UNSUPPORTED_INTEL_WAIT_MS / 1000}s for raw data (user can skip)`);

      // Cancellable wait — check _skipIntelWait every second, ticking progress 50 → 95
      const pollMs = 1000;
      let waited = 0;
      while (waited < UNSUPPORTED_INTEL_WAIT_MS && !this._skipIntelWait) {
        await this.delay(pollMs);
        waited += pollMs;
        const pct = Math.min(95, 50 + Math.floor((waited / UNSUPPORTED_INTEL_WAIT_MS) * 45));
        const remaining = Math.max(0, Math.ceil((UNSUPPORTED_INTEL_WAIT_MS - waited) / 1000));
        this.pushEvent('discoveryProgress', {
          phase: 'unsupportedWait',
          progress: pct,
          message: `Collecting data for ${unsupportedItems.length} unsupported device(s)... ${remaining}s`,
        });
      }

      if (this._skipIntelWait) {
        this.log.info(`Unsupported intel wait skipped by user after ${waited / 1000}s`);
      } else {
        this.log.info(`Unsupported intel wait completed (${waited / 1000}s)`);
      }
    }

    this.pushEvent('discoveryProgress', {
      phase: 'buildingStations',
      progress: 96,
      message: 'Building station list...',
    });

    // Process queued stations
    for (const station of this.pendingStations) {
      const stationType = station.getDeviceType();
      const stationSerial = station.getSerial();

      const s = {
        uniqueId: stationSerial,
        displayName: station.getName(),
        type: stationType,
        typename: DeviceType[stationType],
        disabled: false,
        devices: [],
        properties: station.getProperties(),
        unsupported: false,
      };

      try {
        delete s.properties.picture;
      } catch (error) {
        // ignore
      }

      s.ignored = (this.config['ignoreStations'] ?? []).includes(s.uniqueId);

      // Pre-compute power info for the UI
      s.power = this._computePower(s.properties);

      if (!Device.isStation(stationType)) {
        // Not a hub/base station — the station IS a standalone device (station.type == device.type)

        if (!Device.isSupported(stationType)) {
          // Device type not recognized by eufy-security-client — truly unsupported
          s.unsupported = true;
          s.rawDevice = station.getRawStation ? station.getRawStation() : undefined;

          this.log.warn(`Station "${station.getName()}" (type ${stationType}) is not supported by eufy-security-client`);

          // Immediately add the unsupported station and skip further processing
          this.stations.push(s);
          continue;
        } else {
          // Check if the matching device was emitted by the client
          const hasMatchingDevice = this.pendingDevices.some(d => d.getSerial() === stationSerial);

          if (hasMatchingDevice) {
            s.standalone = true;
            s.disabled = true; // No separate station card; settings accessible via device card

            // Standalone Locks, Doorbells and SmartDrops don't have Security Control
            if (Device.isLock(s.type) || Device.isDoorbell(s.type) || Device.isSmartDrop(s.type)) {
              s.noSecurityControl = true;
            }
          } else {
            // Station exists but no device counterpart was emitted — unsupported
            s.unsupported = true;
            this.log.warn(`Station "${station.getName()}" (${DeviceType[stationType]}) has no matching device and will be marked as unsupported`);

            // Short-circuit processing for unsupported station
            this.stations.push(s);
            continue;
          }
        }
      }

      this.stations.push(s);
    }

    this.pushEvent('discoveryProgress', {
      phase: 'buildingDevices',
      progress: 98,
      message: 'Building device list...',
    });

    // Process queued devices and attach them to stations
    for (const device of this.pendingDevices) {
      const devType = device.getDeviceType();

      const d = {
        uniqueId: device.getSerial(),
        displayName: device.getName(),
        type: devType,
        typename: DeviceType[devType],
        standalone: device.getSerial() === device.getStationSerial(),
        hasBattery: device.hasBattery(),
        isCamera: device.isCamera() || Device.isLockWifiVideo(devType),
        isDoorbell: device.isDoorbell(),
        isKeypad: device.isKeyPad(),
        isMotionSensor: Device.isMotionSensor(devType),
        isEntrySensor: Device.isEntrySensor(devType),
        isLock: Device.isLock(devType),
        isSmartDrop: Device.isSmartDrop(devType),
        supportsRTSP: device.hasPropertyValue(PropertyName.DeviceRTSPStream),
        supportsTalkback: device.hasCommand(CommandName.DeviceStartTalkback),
        DeviceEnabled: device.hasProperty(PropertyName.DeviceEnabled),
        DeviceMotionDetection: device.hasProperty(PropertyName.DeviceMotionDetection),
        DeviceLight: device.hasProperty(PropertyName.DeviceLight),
        DeviceChimeIndoor: device.hasProperty(PropertyName.DeviceChimeIndoor),
        disabled: false,
        properties: device.getProperties(),
        unsupported: false,
      };

      // Mark device as unsupported if eufy-security-client doesn't recognize this device type
      if (!Device.isSupported(devType)) {
        d.unsupported = true;
        d.rawDevice = device.getRawDevice ? device.getRawDevice() : undefined;
      }

      // Pre-compute power info for the UI
      d.power = this._computePower(d.properties);

      try {
        delete d.properties.picture;
      } catch (error) {
        this.log.error(error);
      }

      d.ignored = (this.config['ignoreDevices'] ?? []).includes(d.uniqueId);

      const stationUniqueId = device.getStationSerial();
      const stationIndex = this.stations.findIndex(station => station.uniqueId === stationUniqueId);

      if (stationIndex !== -1) {
        // If parent station is unsupported, propagate flag to device
        if (this.stations[stationIndex].unsupported) {
          d.unsupported = true;
        }

        if (!this.stations[stationIndex].devices) {
          this.stations[stationIndex].devices = [];
        }
        this.stations[stationIndex].devices.push(d);
      } else {
        this.log.error('Station not found for device:', d.displayName);
      }
    }

    // Clear pending queues
    this.pendingStations = [];
    this.pendingDevices = [];

    // Always send the final list to the UI, even if empty
    try {
      this.storeAccessories();
    } catch (error) {
      this.log.error('Error storing accessories:', error);
    }

    this.pushEvent('discoveryProgress', {
      phase: 'done',
      progress: 100,
      message: 'Discovery complete!',
    });

    this.pushEvent('addAccessory', { stations: this.stations, extendedDiscovery: unsupportedItems.length > 0 });
  }

  storeAccessories() {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
    const dataToStore = { version: LIB_VERSION, storedAt: new Date().toISOString(), stations: this.stations };
    fs.writeFileSync(this.storedAccessories_file, JSON.stringify(dataToStore));
  }

  async resetPlugin() {
    try {
      fs.rmSync(this.storagePath, { recursive: true, force: true });
      return { result: 1 };
    } catch (error) {
      this.log.error('Could not reset plugin: ' + error);
      return { result: 0 };
    }
  }

  async getLogFiles() {
    const files = await fs.promises.readdir(this.storagePath);

    const logFiles = files.filter(file => {
      return file.endsWith('.log');
    });

    const nonEmptyLogFiles = await Promise.all(logFiles.map(async file => {
      const filePath = path.join(this.storagePath, file);
      const stats = await fs.promises.stat(filePath);
      if (stats.size > 0) {
        return file;
      }
      return null;
    }));

    return nonEmptyLogFiles.filter(file => file !== null);
  }

  async downloadDiagnostics() {
    this.pushEvent('diagnosticsProgress', { progress: 10, status: 'Collecting log files' });
    const finalLogFiles = await this.getLogFiles();

    this.pushEvent('diagnosticsProgress', { progress: 30, status: 'Adding files to archive' });
    const zip = new Zip();
    let numberOfFiles = 0;
    finalLogFiles.forEach(logFile => {
      const filePath = path.join(this.storagePath, logFile);
      zip.addFile(filePath);
      numberOfFiles++;
    });

    // Include accessories.json for diagnostics
    if (fs.existsSync(this.storedAccessories_file)) {
      zip.addFile(this.storedAccessories_file);
      numberOfFiles++;
    }

    this.pushEvent('diagnosticsProgress', { progress: 40, status: 'Checking archive content' });
    if (numberOfFiles === 0) {
      throw new Error('No diagnostic files were found');
    }

    try {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
      this.diagnosticsZipFilePath = path.join(this.storagePath, `diagnostics-${timestamp}.zip`);

      this.pushEvent('diagnosticsProgress', { progress: 45, status: `Compressing ${numberOfFiles} files` });
      await zip.archive(this.diagnosticsZipFilePath);

      this.pushEvent('diagnosticsProgress', { progress: 80, status: 'Reading content' });
      const fileBuffer = fs.readFileSync(this.diagnosticsZipFilePath);

      this.pushEvent('diagnosticsProgress', { progress: 90, status: 'Returning zip file' });
      return { buffer: fileBuffer, filename: path.basename(this.diagnosticsZipFilePath) };
    } catch (error) {
      this.log.error('Error while generating diagnostics archive: ' + error);
      throw error;
    } finally {
      this.removeDiagnosticsArchive();
    }
  }

  removeDiagnosticsArchive() {
    try {
      if (fs.existsSync(this.diagnosticsZipFilePath)) {
        fs.unlinkSync(this.diagnosticsZipFilePath);
      }
      return true;
    } catch {
      return false;
    }
  }

  async getSystemInfo() {
    const os = await import('os');
    let homebridgeVersion = 'unknown';
    try {
      const hbPkg = require('homebridge/package.json');
      homebridgeVersion = hbPkg.version;
    } catch {
      // Homebridge package not resolvable from here
    }

    let deviceSummary = [];
    try {
      if (fs.existsSync(this.storedAccessories_file)) {
        const storedData = JSON.parse(fs.readFileSync(this.storedAccessories_file, 'utf-8'));
        if (storedData.stations) {
          deviceSummary = storedData.stations.map(s => ({
            name: s.displayName,
            type: s.typename,
            devices: (s.devices || []).map(d => ({
              name: d.displayName,
              type: d.typename,
            })),
          }));
        }
      }
    } catch {
      // ignore
    }

    this.log.debug('System info requested by UI');

    return {
      pluginVersion: LIB_VERSION,
      eufyClientVersion: libVersion,
      homebridgeVersion,
      nodeVersion: process.version,
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      devices: deviceSummary,
    };
  }
}

(() => new UiServer())();
