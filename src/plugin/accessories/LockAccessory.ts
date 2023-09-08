import { CharacteristicValue, PlatformAccessory } from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Lock, PropertyName } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LockAccessory extends DeviceAccessory {

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: Lock,
  ) {
    super(platform, accessory, device);

    this.platform.log.debug(`${this.accessory.displayName} Constructed Lock`);

    if (this.device.hasProperty('DeviceLocked')) {

      // Append Service.LockManagement looks like mandatory for Apple's HAP but it seems to do nothing
      this.registerCharacteristic({
        serviceType: this.platform.Service.LockManagement,
        characteristicType: this.platform.Characteristic.Version,
        getValue: (data) => () => {
          return 1;
        },
      });

      this.registerCharacteristic({
        serviceType: this.platform.Service.LockMechanism,
        characteristicType: this.platform.Characteristic.LockCurrentState,
        getValue: (data) => this.getLockStatus(),
        onValue: (service, characteristic) => {
          this.device.on('locked', () => {
            characteristic.updateValue(this.convertLockStatusCode(this.getLockStatus()));
          });
        },
      });

      this.registerCharacteristic({
        serviceType: this.platform.Service.LockMechanism,
        characteristicType: this.platform.Characteristic.LockTargetState,
        getValue: (data) => this.getLockStatus(),
        setValue: (value) => this.setLockTargetState(value),
        onValue: (service, characteristic) => {
          this.device.on('locked', () => {
            characteristic.updateValue(this.convertLockStatusCode(this.getLockStatus()));
          });
        },
      });

      this.initSensorService(this.platform.Service.LockMechanism);

    } else {
      this.platform.log.warn(`${this.accessory.displayName} has no lock`);
      throw Error(`${this.accessory.displayName} raise error to check and attach a lock: ${Error}`);
    }
  }

  private getLockStatus() {
    const lockStatus = this.device.getPropertyValue(PropertyName.DeviceLocked);
    this.platform.log.debug(`${this.accessory.displayName} getLockStatus: ${lockStatus}`);
    return this.convertLockStatusCode(lockStatus);
  }

  private async setLockTargetState(state: CharacteristicValue) {
    try {
      await this.setPropertyValue(PropertyName.DeviceLocked, !!state);
    } catch (err) {
      this.platform.log.error(this.accessory.displayName, 'Lock target state could not be set: ' + err);
    }
  }

  // Function to convert lock status codes to corresponding HomeKit lock states
  convertLockStatusCode(lockStatus) {
    // Mapping of lock status codes to their corresponding meanings
    // 1: "1",
    // 2: "2",
    // 3: "UNLOCKED",
    // 4: "LOCKED",
    // 5: "MECHANICAL_ANOMALY",
    // 6: "6",
    // 7: "7",

    // Log the current lock status for debugging purposes
    this.platform.log.debug(`${this.accessory.displayName} LockStatus: ${lockStatus}`);

    // Determine the HomeKit lock state based on the provided lock status
    switch (lockStatus) {
      // If lockStatus is true (locked) or 4 (LOCKED)◊
      case true:
      case 4:
        return this.platform.Characteristic.LockCurrentState.SECURED;
      // If lockStatus is false (unlocked) or 3 (UNLOCKED)
      case false:
      case 3:
        return this.platform.Characteristic.LockCurrentState.UNSECURED;
      // If lockStatus is 5 (MECHANICAL_ANOMALY)
      case 5:
        // Return JAMMED as the lock state if jammed
        return this.platform.Characteristic.LockCurrentState.JAMMED;
      default:
        // Log a warning for unknown lock status feedback
        this.platform.log.warn(`${this.accessory.displayName} Something wrong on the lockstatus feedback`);
        // Return UNKNOWN as the lock state for unknown lockStatus values
        return this.platform.Characteristic.LockCurrentState.UNKNOWN;
    }
  }
}