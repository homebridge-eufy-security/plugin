const { EufySecurity, DeviceType, AuthResult } = require('eufy-security-client');
const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');

const bunyan = require('bunyan');
const bunyanDebugStream = require('bunyan-debug-stream');
const plugin = require('../package.json');
const fs = require('fs');
const zlib = require('zlib');


class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.driver;

    this.storagePath = this.homebridgeStoragePath + '/eufysecurity';

    this.stations_file = this.storagePath + '/stations.json';

    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath);
    }

    const logfileStream = fs.createWriteStream(this.storagePath + '/config_ui_log', { flags: 'w' });

    this.log = bunyan.createLogger({
      name: '[' + plugin.version + ']',
      hostname: '',
      streams: [{
        level: 'info',
        type: 'raw',
        stream: bunyanDebugStream({
          forceColor: true,
          showProcess: false,
          showPid: false,
          showDate: false,
          out: logfileStream,
        }),
      }],
      serializers: bunyanDebugStream.serializers,
    });

    this.config = {
      language: 'en',
      persistentDir: this.storagePath,
      p2pConnectionSetup: 0,
      pollingIntervalMinutes: 10,
      eventDurationSeconds: 10,
      acceptInvitations: true,
    };

    // create request handlers
    this.onRequest('/init', this.init.bind(this));
    this.onRequest('/auth', this.auth.bind(this));
    this.onRequest('/check-captcha', this.checkCaptcha.bind(this));
    this.onRequest('/check-otp', this.checkOtp.bind(this));
    this.onRequest('/getStations', this.getStations.bind(this));
    this.onRequest('/reset', this.reset.bind(this));
    this.onRequest('/get-lib-logs', this.getLibLogs.bind(this));

    // must be called when the script is ready to accept connections
    this.ready();
  }

  async init(body) {

    if (body) {
      this.auth(body);
    }

  }

  async authenticate(options = null) {

    try {

      return new Promise(async (resolve, reject) => {
        await this.driver.connect(options);
        this.driver.on('captcha request', (id, captcha) => {
          this.log.info('AuthResult.CAPTCHA_NEEDED');
          this.pushEvent('CAPTCHA_NEEDED', { id: id, captcha: captcha });
          resolve({ result: 1 });
        });
        this.driver.on('tfa request', () => {
          this.log.info('AuthResult.SEND_VERIFY_CODE');
          this.pushEvent('SEND_VERIFY_CODE', null);
          resolve({ result: 2 });
        });
        this.driver.on('connect', () => {
          this.log.info('AuthResult.OK');
          resolve({ result: 3 });
        });
      });

    } catch (e) {
      this.log.error('Error authenticate:', e.message);
      return { result: 0 }; // Wrong username and/or password
    }
  }

  /**
   * Handle requests sent to /request-otp
   */
  async auth(body = null) {

    if (body) {
      this.config['username'] = body.username;
      this.config['password'] = body.password;
      if (body.country !== null && body.country !== void 0) {
        this.config['country'] = body.country;
      } else {
        this.config['country'] = 'US';
      }
    }

    this.driver = await EufySecurity.initialize(this.config, this.log);

    this.driver.on('captcha request', (id, captcha) => {
      this.log.info('captcha request:', id, captcha);
      this.pushEvent('CAPTCHA_NEEDED', { id: id, captcha: captcha });
    });

    this.driver.on('tfa request', () => {
      this.log.info('tfa request');
      this.pushEvent('SEND_VERIFY_CODE', null);
    });

    this.driver.on('connect', () => {
      this.log.info('connected!');
      this.pushEvent('CONNECTED', null);
    });

    return await this.authenticate();

  }

  /**
   * Handle requests sent to /check-otp
   */
  async checkOtp(body) {
    return await this.authenticate({ verifyCode: body.code });
  }

  /**
   * Handle requests sent to /check-otp
   */
  async checkCaptcha(body) {
    return await this.authenticate({ captcha: { captchaCode: body.captcha, captchaId: body.id } });
  }

  async getCachedStations() {
    try {
      return JSON.parse(fs.readFileSync(this.stations_file, { encoding: 'utf-8' }));
    } catch {
      return null;
    }
  }

  async compressFile(filePath) {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream
        .pipe(zlib.createGzip())
        .pipe(fs.createWriteStream(`${filePath}.gz`))
        .on("finish", () => {
          console.log(`Successfully compressed the file at ${filePath}`);
          resolve(fs.readFileSync(`${filePath}.gz`), { flag: "r" });
        });

    });
  }

  async getLibLogs() {
    try {
      const gzip = await this.compressFile(this.storagePath + '/log-lib.log');
      return { result: 1, data: gzip };
    } catch (err) {
      this.log.error(err);
      return { result: 0 };
    }
  }

  async isNeedRefreshStationsCache() {
    let endTime, now, stat;

    try {
      stat = fs.statSync(this.stations_file);
      now = new Date().getTime();
      endTime = new Date(stat.ctime).getTime() + 3600000;
      if (now > endTime) return true;
    } catch {
      return true;
    }

    try {
      const c = await this.getCachedStations();
      if (c.length === 0) return true;
    } catch {
      return true;
    }

    return false;
  }

  async refreshDevices() {

    try {
      await this.refreshData();
      const Eufy_stations = await this.driver.getStations();
      const Eufy_devices = await this.driver.getDevices();

      let stations = [];

      for (const station of Eufy_stations) {

        if (station.getRawStation().member.member_type === 1) {
          this.log.info('You\'re using guest admin account with this plugin! This is recommanded way!');
        } else {
          this.log.warn('You\'re not using guest admin account with this plugin! This is not recommanded way!');
          this.log.warn('Please look here for more details: https://github.com/homebridge-eufy-security/plugin/wiki/Create-a-dedicated-admin-account-for-Homebridge-Eufy-Security-Plugin');
          this.log.warn(station.getSerial() + ' type: ' + station.getRawStation().member.member_type);
        }

        const object = {
          uniqueId: station.getSerial(),
          displayName: station.getName(),
          type: DeviceType[station.getDeviceType()],
          devices: [],
        }

        stations.push(object);

      }

      for (const device of Eufy_devices) {

        const object = {
          uniqueId: device.getSerial(),
          displayName: device.getName(),
          type: DeviceType[device.getDeviceType()],
          station: device.getStationSerial(),
        }

        stations.find((o, i, a) => {
          if (o.uniqueId === object.station)
            a[i].devices.push(object);
        });

      }

      if (stations.length) {
        fs.writeFileSync(this.stations_file, JSON.stringify(stations));
      }

      return stations;

    } catch (e) {
      this.log.error('Error refreshDevices():', e.message);
      return null; // Error
    } finally {
      this.driver.close();
    }
  }

  /**
   * Handle requests sent to /refreshData
   */
  async refreshData() {

    if (this.driver.api.token && this.driver.connected == true) {
      try {
        await this.driver.refreshCloudData();
        return { result: 1 }; // Connected
      } catch (e) {
        this.log.error('Error refreshData():', e.message);
        return { result: 0 }; // Error
      }
    }

    if (!this.driver.api.token && this.driver.connected == false) {
      return { result: 0 }; // Wrong OTP
    }

  }

  /**
   * Handle requests sent to /getStations
   */
  async getStations(r = false) {

    // Do we really need to ask Eufy ? cached is enough ?
    if (!(await this.isNeedRefreshStationsCache() || r.refresh)) {
      this.log.info('No need to refresh the devices list');
      try {
        const stations = await this.getCachedStations();
        return { result: 1, stations: stations }; // Connected
      } catch (e) {
        this.log.error('Error getStations():', e.message);
        return { result: 0 }; // Error
      }
    }

    this.log.info('Need to refresh the devices list');

    this.driver.isConnected();

    try {
      if (this.driver.isConnected()) {
        await this.refreshData();
        const stations = await this.refreshDevices();
        return { result: 1, stations: stations }; // Connected
      }
      const a = await this.auth();
      if (a.result = 3) {
        await this.refreshData();
        const stations = await this.refreshDevices();
        return { result: 1, stations: stations }; // Connected
      } else {
        return { result: r.result };
      }
    } catch (e) {
      this.log.error('Error getStations():', e.message);
      return { result: 0 }; // Error
    }

  }

  /**
   * Handle requests sent to /reset
   */
  async reset() {
    try {
      fs.rmSync(this.storagePath, { recursive: true });
      return { result: 1 }; //file removed
    } catch (err) {
      return { result: 0 }; //error while removing the file
    }
  }
}

// start the instance of the class
(() => {
  return new UiServer;
})();
