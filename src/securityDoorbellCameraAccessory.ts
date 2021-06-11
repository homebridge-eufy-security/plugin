import { Service, PlatformAccessory } from 'homebridge';

import { EufySecurityPlatform } from './platform';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

import { DoorbellCamera, Device, DeviceType } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SecurityDoorbellCameraAccessory {
  private service: Service;

  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly accessory: PlatformAccessory,
    private eufyDevice: DoorbellCamera,
  ) {
    this.platform.log.debug('Constructed Doorbell');
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

    const doorbellService =
    this.accessory.getService(this.platform.Service.Doorbell) ||
    this.accessory.addService(this.platform.Service.Doorbell);

    // set the Battery service characteristics
    doorbellService.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics of Battery service
    doorbellService
      .getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .on('get', this.handleProgrammableSwitchEventGet.bind(this));
  
    this.eufyDevice.on('rings', (device: Device, state: boolean) =>
      this.onDeviceRingsPushNotification(),
    );

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
  }

  handleEventSnapshotsActiveGet(callback) {
    this.platform.log.debug('Triggered GET EventSnapshotsActive');

    // set this to a valid value for EventSnapshotsActive
    const currentValue = this.platform.Characteristic.EventSnapshotsActive.DISABLE;

    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "Event Snapshots Active" characteristic
   */
  handleEventSnapshotsActiveSet(value) {
    this.platform.log.debug('Triggered SET EventSnapshotsActive:', value);
  }

  /**
   * Handle requests to get the current value of the "HomeKit Camera Active" characteristic
   */
  handleHomeKitCameraActiveGet(callback) {
    this.platform.log.debug('Triggered GET HomeKitCameraActive');

    // set this to a valid value for HomeKitCameraActive
    const currentValue = this.platform.Characteristic.HomeKitCameraActive.OFF;

    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "HomeKit Camera Active" characteristic
   */
  handleHomeKitCameraActiveSet(value) {
    this.platform.log.debug('Triggered SET HomeKitCameraActive:', value);
  }

  /**
   * Handle requests to get the current value of the "Status Low Battery" characteristic
   */
  async handleBatteryLevelGet(callback) {
    this.platform.log.debug('Triggered GET BatteryLevel');

    // set this to a valid value for SecuritySystemCurrentState
    const currentValue = await this.getCurrentBatteryLevel();
    this.platform.log.debug('Handle Current battery level:  -- ', currentValue);

    callback(null, currentValue);
  }

  async getCurrentBatteryLevel() {
    const batteryLevel = this.eufyDevice.getBatteryValue();
    return batteryLevel.value as number;
  }

  async handleProgrammableSwitchEventGet(callback) {
    callback(null, null);
  }

  private onDeviceRingsPushNotification(): void {
    this.platform.log.debug('DoorBell ringing');
    this.service
      .getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .updateValue(this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
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
}
