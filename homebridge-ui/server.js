const { EufySecurity, DeviceType } = require('eufy-security-client');
const bunyan = require('bunyan');
const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.driver;

    const storagePath = this.homebridgeStoragePath;
    this.log = bunyan.createLogger({ name: 'eufyLog - Settings' });

    this.config = {
      country: 'US',
      language: 'en',
      persistentDir: storagePath,
      p2pConnectionSetup: 0,
      pollingIntervalMinutes: 10,
      eventDurationSeconds: 10,
    };

    // create request handlers
    this.onRequest('/request-otp', this.requestOtp.bind(this));
    this.onRequest('/check-otp', this.checkOtp.bind(this));

    // must be called when the script is ready to accept connections
    this.ready();
  }


  /**
   * Handle requests sent to /request-otp
   */
  async requestOtp(body) {

    this.config['username'] = body.username;
    this.config['password'] = body.password;

    this.driver = new EufySecurity(this.config, this.log);

    await this.driver.connect();

    if (this.driver.api.token && this.driver.connected == true) {
      await this.driver.refreshData();
      const stations = await this.getStations();
      return { result: 2, stations: stations }; // Connected
    }

    if (this.driver.api.token && this.driver.connected == false) {
      return { result: 1 }; // OTP needed
    }

    if (!this.driver.api.token && this.driver.connected == false) {
      return { result: 0 }; // Wrong username and/or password
    }

  }

  async getStations() {

    const Eufy_stations = await this.driver.getStations();
    const Eufy_devices = await this.driver.getDevices();

    const stations = [];

    for (const station of Eufy_stations) {

      var object = {
        uniqueId: station.getSerial(),
        displayName: station.getName(),
        type: DeviceType[station.getDeviceType()],
        devices: [],
      }

      stations.push(object);
    }

    for (const device of Eufy_devices) {

      var object = {
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
  }

  /**
   * Handle requests sent to /check-otp
   */
  async checkOtp(body) {

    await this.driver.connect(body.code);

    if (this.driver.api.token && this.driver.connected == true) {
      await this.driver.refreshData();
      const stations = await this.getStations();
      return { result: 2, stations: stations }; // Connected
    }

    if (!this.driver.api.token && this.driver.connected == false) {
      return { result: 0 }; // Wrong OTP
    }

  }
}

// start the instance of the class
(() => {
  return new UiServer;
})();
