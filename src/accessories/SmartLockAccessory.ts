import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Device, Lock, PropertyName } from 'eufy-security-client';

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
      .onGet(this.handleLockCurrentStateGet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onGet(this.handleLockTargetStateGet.bind(this))
      .onSet(this.handleLockTargetStateSet.bind(this));

    this.SmartLock.on('locked', (device: Device, lock: boolean) =>
      this.onDeviceLockPushNotification(device, lock),
    );
    
  }

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleLockCurrentStateGet(): Promise<CharacteristicValue> {
    const lockStatus = this.getLockStatus();
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET LockCurrentState', lockStatus);
    return lockStatus as number;
  }

  async handleLockTargetStateGet(): Promise<CharacteristicValue> {
    const lockStatus = this.getLockStatus(false);
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET LockTargetState', lockStatus);
    return lockStatus as number;
  }

  async handleLockTargetStateSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered SET LockTargetState', value);   
    const stationSerial = this.SmartLock.getStationSerial();
    const station = this.platform.getStationById(stationSerial);
    station.lockDevice(this.SmartLock, !!value);
  }

  getLockStatus(current = true) {
    const lockStatus = this.SmartLock.isLocked();
    return this.convertlockStatusCode(lockStatus.value, current);
  }

  convertlockStatusCode(lockStatus, current = true) {
    // 1: "1",
    // 2: "2",
    // 3: "UNLOCKED",
    // 4: "LOCKED",
    // 5: "MECHANICAL_ANOMALY",
    // 6: "6",
    // 7: "7",

    this.platform.log.debug(this.accessory.displayName, 'LockStatus', lockStatus);

    const characteristic = (current) ? this.platform.Characteristic.LockCurrentState : this.platform.Characteristic.LockTargetState;

    switch (lockStatus) {
      case true:
      case 4:
        return characteristic.SECURED;
      case false:
      case 3:
        return characteristic.UNSECURED;
      // case 3:
      //   return characteristic.JAMMED;
      default:
        this.platform.log.warn(this.accessory.displayName, 'Something wrong on the lockstatus feedback');
        return this.platform.Characteristic.LockCurrentState.UNKNOWN;
    }
  }

  private onDeviceLockPushNotification(
    device: Device,
    lockStatus: boolean,
  ): void {

    this.platform.log.debug(this.accessory.displayName, 'Handle Lock Status:  -- ', lockStatus);

    this.service
      .getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .updateValue(this.convertlockStatusCode(lockStatus));
  }
}
