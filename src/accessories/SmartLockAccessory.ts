import { Service, PlatformAccessory } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Device, Lock, PropertyValue, DeviceType } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SmartLockAccessory extends DeviceAccessory {

  protected service: Service;
  protected SmartLock: Lock;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: Lock,
  ) {
    super(platform, accessory, eufyDevice);

    this.platform.log.debug(this.accessory.displayName, 'Constructed SmartLock');

    this.SmartLock = eufyDevice;

    this.service =
      this.accessory.getService(this.platform.Service.LockMechanism) ||
      this.accessory.addService(this.platform.Service.LockMechanism);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .on('get', this.handleLockCurrentStateGet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.LockTargetState)
      .on('get', this.handleLockTargetStateGet.bind(this))
      .on('set', this.handleLockTargetStateSet.bind(this));

    this.SmartLock.on('locked', (device: Device, open: boolean) =>
      this.onDeviceOpenPushNotification(device, open),
    );

    // this.eufyDevice.on('motion detected', (device: Device, motion: boolean) =>
    //   this.onDeviceMotionDetectedPushNotification(device, motion),
    // );

    if (this.SmartLock.hasBattery && this.SmartLock.hasBattery()) {
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

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleLockCurrentStateGet(callback) {
    this.platform.log.debug('Triggered GET LockCurrentState');

    // set this to a valid value for LockCurrentState
    const lockStatus = this.getLockStatus() ? this.platform.Characteristic.LockCurrentState.SECURED : this.platform.Characteristic.LockCurrentState.UNSECURED;

    callback(null, lockStatus as number);
  }

  async handleLockTargetStateGet(callback) {
    this.platform.log.debug('Triggered GET LockTargetState');

    // set this to a valid value for LockTargetState
    const lockStatus = this.getLockStatus() ? this.platform.Characteristic.LockTargetState.SECURED : this.platform.Characteristic.LockTargetState.UNSECURED;

    callback(null, lockStatus as number);
  }

  async handleLockTargetStateSet(callback) {
    this.platform.log.warn('Open/Close trigger from homekit is not implemented');
  }

  async getLockStatus() {
    const lockStatus = (this.SmartLock.isLocked());
    return this.convertlockStatusCode(lockStatus);
  }

  convertlockStatusCode(lockStatus) {
    // 1: "1",
    // 2: "2",
    // 3: "UNLOCKED",
    // 4: "LOCKED",
    // 5: "MECHANICAL_ANOMALY",
    // 6: "6",
    // 7: "7",
    switch (lockStatus) {
      case 3:
        return this.platform.Characteristic.LockTargetState.SECURED;
      case 4:
        return this.platform.Characteristic.LockTargetState.UNSECURED;
      default:
        this.platform.log.warn(this.accessory.displayName, 'Something wrong on the lockstatus feedback');
        return this.platform.Characteristic.LockTargetState.UNSECURED;
    }
  }

  private onDeviceOpenPushNotification(
    device: Device,
    lockStatus: boolean,
  ): void {

    this.platform.log.debug(this.accessory.displayName, 'Handle Lock Status:  -- ', lockStatus);

    this.service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .updateValue(this.convertlockStatusCode(lockStatus));
  }

  /**
   * Handle requests to get the current value of the "Status Low Battery" characteristic
   */
  async getCurrentBatteryLevel() {
    const batteryLevel = this.SmartLock.getBatteryValue();
    return batteryLevel.value as number;
  }

  async handleBatteryLevelGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET BatteryLevel');

    // set this to a valid value for SecuritySystemCurrentState
    const currentValue = await this.getCurrentBatteryLevel();
    this.platform.log.debug(this.accessory.displayName, 'Handle Current battery level:  -- ', currentValue);

    callback(null, currentValue);
  }
}
