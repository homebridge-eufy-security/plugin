const { EufySecurity, DeviceType, AuthResult } = require('eufy-security-client');
const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');

const bunyan = require('bunyan');
const bunyanDebugStream = require('bunyan-debug-stream');
const plugin = require('../package.json');
const fs = require('fs')


class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.driver;

    const storagePath = this.homebridgeStoragePath;
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
        }),
      }],
      serializers: bunyanDebugStream.serializers,
    });

    this.config = {
      language: 'en',
      persistentDir: storagePath,
      p2pConnectionSetup: 0,
      pollingIntervalMinutes: 10,
      eventDurationSeconds: 10,
      acceptInvitations: true,
    };

    // create request handlers
    this.onRequest('/auth', this.auth.bind(this));
    this.onRequest('/check-captcha', this.checkCaptcha.bind(this));
    this.onRequest('/check-otp', this.checkOtp.bind(this));
    this.onRequest('/refreshData', this.refreshData.bind(this));
    this.onRequest('/getStations', this.getStations.bind(this));
    this.onRequest('/reset', this.reset.bind(this));

    // must be called when the script is ready to accept connections
    this.ready();
  }

  async authenticate(verifyCodeOrCaptcha = null, captchaId = null) {
    try {
      let retries = 0;
      await this.driver.api.loadApiBase().catch((error) => {
        this.log.error("Load Api base Error", error);
      });

      while (true) {
        switch (await this.driver.api.authenticate(verifyCodeOrCaptcha, captchaId)) {
          case AuthResult.CAPTCHA_NEEDED:
            this.log.info('AuthResult.CAPTCHA_NEEDED');
            return { result: 1 };
          case AuthResult.SEND_VERIFY_CODE:
            this.log.info('AuthResult.SEND_VERIFY_CODE');
            return { result: 2 };
          case AuthResult.OK:
            this.log.info('AuthResult.OK');
            return { result: 3 };
          case AuthResult.RENEW:
            this.log.info('AuthResult.RENEW');
            break;
          case AuthResult.ERROR:
            this.log.info('AuthResult.ERROR');
            return { result: 0 };
          default:
            this.log.info('AuthResult.KO');
            return { result: 0 };
        }

        if (retries > 4) {
          this.log.error("Max connect attempts reached, interrupt");
          return { result: 0 };
        } else {
          retries += 1;
        }

      }

    } catch (e) {
      this.log.info('Error:', e.message);
      return { result: 0 }; // Wrong username and/or password
    }
  }

  /**
   * Handle requests sent to /request-otp
   */
  async auth(body) {

    this.config['username'] = body.username;
    this.config['password'] = body.password;
    this.config['country'] = body.country || 'US';

    this.log.info('country:', body.country || 'US');

    this.driver = new EufySecurity(this.config, this.log);

    this.driver.api.on('captcha request', (id, captcha) => {
      this.log.debug('captcha request:', id, captcha);
      this.pushEvent('captcha', { id: id, captcha: captcha });
    });

    return await this.authenticate();

  }

  /**
   * Handle requests sent to /check-otp
   */
  async checkOtp(body) {
    return await this.authenticate(body.code);
  }

  /**
   * Handle requests sent to /check-otp
   */
  async checkCaptcha(body) {
    return await this.authenticate(body.captcha, body.id);
  }

  async listDevices() {

    try {
      const Eufy_stations = await this.driver.getStations();
      const Eufy_devices = await this.driver.getDevices();

      const stations = [];

      for (const station of Eufy_stations) {

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

      return stations;

    } catch (e) {
      this.log.error('Error:', e.message);
      return null; // Error
    } finally {
      this.driver.close();
    }
  }

  /**
   * Handle requests sent to /refreshData
   */
  async refreshData(body) {

    if (this.driver.api.token && this.driver.connected == true) {
      try {
        await this.driver.refreshCloudData();
        return { result: 1 }; // Connected
      } catch (e) {
        this.log.error('Error:', e.message);
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
  async getStations(body) {

    if (this.driver.api.token && this.driver.connected == true) {
      try {
        const stations = await this.listDevices();
        return { result: 1, stations: stations }; // Connected
      } catch (e) {
        this.log.error('Error:', e.message);
        return { result: 0 }; // Error
      }
    }

    if (!this.driver.api.token && this.driver.connected == false) {
      return { result: 0 }; // Wrong OTP
    }

  }

  /**
   * Handle requests sent to /reset
   */
  async reset(body) {

    const path = this.config['persistentDir'] + '/eufysecurity/persistent.json';

    try {
      fs.unlinkSync(path);
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
