import { Service, PlatformAccessory } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Device, MotionSensor, PropertyValue, DeviceType } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class MotionSensorAccessory extends DeviceAccessory {

  protected service: Service;
  protected MotionSensor: MotionSensor;

  protected motion_triggered: boolean;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: MotionSensor,
  ) {
    super(platform, accessory, eufyDevice);

    this.platform.log.debug(this.accessory.displayName, 'Constructed Motion Sensor');

    this.MotionSensor = eufyDevice;
    
    this.motion_triggered = false;

    this.service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .on('get', this.handleMotionDetectedGet.bind(this));

    this.eufyDevice.on('motion detected', (device: Device, motion: boolean) =>
      this.onDeviceMotionDetectedPushNotification(device, motion),
    );

    if(this.MotionSensor.isBatteryLow && this.MotionSensor.isBatteryLow()) {
      this.platform.log.debug(this.accessory.displayName, 'has a battery, so append batteryService characteristic to him.');

      const batteryService =
      this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery);

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

  async isMotionDetected() {
    const isMotionDetected = this.MotionSensor.isMotionDetected();
    return isMotionDetected as boolean;
  }

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleMotionDetectedGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET MotionDetected');

    const currentValue = await this.isMotionDetected();
    this.platform.log.debug(this.accessory.displayName, 'Handle Motion Sensor:  -- ', currentValue);

    callback(null, currentValue as boolean);
  }

  private onDeviceMotionDetectedPushNotification(
    device: Device,
    motion: boolean,
  ): void {
    this.motion_triggered = (this.motion_triggered) ? false : true;
    this.platform.log.info(this.accessory.displayName, 'Handle Motion Sensor:  -- ', this.motion_triggered);
    this.service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .updateValue(this.motion_triggered);
  }

  /**
   * Handle requests to get the current value of the "Status Low Battery" characteristic
   */
  async handleBatteryLevelGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET BatteryLevel');

    // set this to a valid value for SecuritySystemCurrentState
    const currentValue = await this.getCurrentBatteryLevel();
    this.platform.log.info(this.accessory.displayName, 'Handle Current battery level:  -- ', currentValue);

    callback(null, currentValue);
  }

  async getCurrentBatteryLevel() {
    const batteryLevel = (this.MotionSensor.isBatteryLow()) ? 100 : 0;

    return batteryLevel as number;
  }
}
