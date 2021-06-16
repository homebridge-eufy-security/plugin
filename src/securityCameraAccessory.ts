import { Service, PlatformAccessory } from 'homebridge';

import { EufySecurityPlatform } from './platform';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

import { Camera, Device, DeviceType, Station } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SecurityCameraAccessory {
  private service: Service;
  private switchService: Service;

  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly accessory: PlatformAccessory,
    private eufyDevice: Camera,
  ) {
    this.platform.log.debug(this.accessory.displayName, 'Constructed Camera');
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Eufy')
      .setCharacteristic(
        this.platform.Characteristic.Model,
        DeviceType[eufyDevice.getDeviceType()],
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        eufyDevice.getSerial(),
      )
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        eufyDevice.getSoftwareVersion(),
      )
      .setCharacteristic(
        this.platform.Characteristic.HardwareRevision,
        eufyDevice.getHardwareVersion(),
      );

    this.service =
      this.accessory.getService(this.platform.Service.CameraOperatingMode) ||
      this.accessory.addService(this.platform.Service.CameraOperatingMode);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    this.service
      .getCharacteristic(this.platform.Characteristic.EventSnapshotsActive)
      .on('get', this.handleEventSnapshotsActiveGet.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.EventSnapshotsActive)
      .on('set', this.handleEventSnapshotsActiveSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.HomeKitCameraActive)
      .on('get', this.handleHomeKitCameraActiveGet.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.HomeKitCameraActive)
      .on('set', this.handleHomeKitCameraActiveSet.bind(this));

    const MotionService =
    this.accessory.getService(this.platform.Service.MotionSensor) ||
    this.accessory.addService(this.platform.Service.MotionSensor);

    // set the Battery service characteristics
    MotionService.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics of Battery service
    MotionService
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .on('get', this.handleMotionDetectedGet.bind(this));

    this.eufyDevice.on('motion detected', (device: Device, open: boolean) =>
      this.onDeviceMotionDetectedPushNotification(device, open),
    );

    if(this.eufyDevice.hasBattery()) {
      this.platform.log.debug(this.accessory.displayName, 'has a battery, so append batteryService characteristic to him.');

      const batteryService =
      this.accessory.getService(this.platform.Service.BatteryService) ||
      this.accessory.addService(this.platform.Service.BatteryService);

      // set the Battery service characteristics
      batteryService.setCharacteristic(
        this.platform.Characteristic.Name,
        accessory.displayName,
      );

      // create handlers for required characteristics of Battery service
      batteryService
        .getCharacteristic(this.platform.Characteristic.BatteryLevel)
        .on('get', this.handleBatteryLevelGet.bind(this));
    }

    // create a new Switch service
    this.switchService = this.accessory.getService(this.platform.Service.Switch) ||
        this.accessory.addService(this.platform.Service.Switch);
    
    // create handlers for required characteristics
    this.switchService.getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handleOnGet.bind(this))
      .on('set', this.handleOnSet.bind(this));
  }

  /**
   * Handle requests to get the current value of the "Status Low Battery" characteristic
   */
  async handleBatteryLevelGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET BatteryLevel');

    // set this to a valid value for SecuritySystemCurrentState
    const currentValue = await this.getCurrentBatteryLevel();
    this.platform.log.debug(this.accessory.displayName, 'Handle Current battery level:  -- ', currentValue);

    callback(null, currentValue);
  }

  async getCurrentBatteryLevel() {
    const batteryLevel = this.eufyDevice.getBatteryValue();

    return batteryLevel.value as number;
  }

  async isMotionDetected() {
    const isMotionDetected = this.eufyDevice.isMotionDetected();
    return isMotionDetected as boolean;
  }

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleMotionDetectedGet(callback) {
    this.platform.log.info(this.accessory.displayName, 'Triggered GET MotionDetected');

    const currentValue = await this.isMotionDetected();
    this.platform.log.info(this.accessory.displayName, 'Handle Motion Sensor:  -- ', currentValue);

    callback(null, currentValue as boolean);
  }

  private onDeviceMotionDetectedPushNotification(
    device: Device,
    open: boolean,
  ): void {
    this.service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .updateValue(open);
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  async handleOnGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET On');
    
    // set this to a valid value for On
    const currentValue = this.eufyDevice.isEnabled().value;
    
    this.platform.log.info(this.accessory.displayName, 'Handle Switch:  -- ', currentValue);

    /*
     * The callback function should be called to return the value
     * The first argument in the function should be null unless and error occured
     * The second argument in the function should be the current value of the characteristic
     * This is just an example so we will return the value from `this.isOn` which is where we stored the value in the set handler
     */
    callback(null, currentValue);
  }
    
  /**
       * Handle requests to set the "On" characteristic
       */
  async handleOnSet(value, callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered SET On: ' + value);

    const station = this.platform.getStationById(this.eufyDevice.getStationSerial());
        
    station.enableDevice(this.eufyDevice, value);

    /*
     * The callback function should be called to return the value
     * The first argument in the function should be null unless and error occured
     */
    callback(null);
  }
}
