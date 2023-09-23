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

    if (this.device.hasProperty('locked')) {

      // Lock Management is required by Apple guidelines, though not functional for our use case.
      // Implementing as a no-op to meet requirements.
      this.registerCharacteristic({
        serviceType: this.platform.Service.LockManagement,
        characteristicType: this.platform.Characteristic.Version,
        getValue: (data) => {
          return '1.0';
        },
      });

      // Sets the Auto Security Timeout for the Lock Management Service.
      // The value represents the time in seconds that the accessory waits after becoming unsecured,
      // before trying to enter the secured state again.
      // A value of 0 disables this feature.
      // Currently set to 3 seconds.
      this.registerCharacteristic({
        serviceType: this.platform.Service.LockManagement,
        characteristicType: this.platform.Characteristic.LockManagementAutoSecurityTimeout,
        getValue: (data) => {
          return 3;
        },
      });

      this.registerCharacteristic({
        serviceType: this.platform.Service.LockManagement,
        characteristicType: this.platform.Characteristic.AdministratorOnlyAccess,
        getValue: (data) => () => {
          this.platform.log.debug(`${this.accessory.displayName} GET AdministratorOnlyAccess: ${data}`);
          return true;
        },
        setValue: (value) => () => {
          this.platform.log.debug(`${this.accessory.displayName} SET AdministratorOnlyAccess: ${value}`);
        },
      });

      this.registerCharacteristic({
        serviceType: this.platform.Service.LockManagement,
        characteristicType: this.platform.Characteristic.LockControlPoint,
        setValue: (value) => () => {
          this.platform.log.debug(`${this.accessory.displayName} SET LockControlPoint: ${value}`);
        },
      });

      this.registerCharacteristic({
        serviceType: this.platform.Service.LockMechanism,
        characteristicType: this.platform.Characteristic.LockCurrentState,
        getValue: (data) => this.getLockStatus(),
        onValue: (service, characteristic) => {
          this.device.on('locked', () => {
            characteristic.updateValue(this.getLockStatus());
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
            characteristic.updateValue(this.getLockStatus());
          });
        },
      });

      this.initSensorService(this.platform.Service.LockMechanism);

    } else {
      this.platform.log.error(`${this.accessory.displayName} has no lock`);
    }

    this.pruneUnusedServices();
  }

  private getLockStatus() {
    const lockStatus = this.device.getPropertyValue(PropertyName.DeviceLocked);
    this.platform.log.debug(`${this.accessory.displayName} getLockStatus: ${lockStatus}`);
    return this.convertLockStatusCode(lockStatus);
  }

  private async setLockTargetState(state: CharacteristicValue) {
    try {
      await this.setPropertyValue(PropertyName.DeviceLocked, !!state);
    } catch (error) {
      this.platform.log.error(`${this.accessory.displayName} Lock target state
      (${JSON.stringify(typeof state)} / ${JSON.stringify(state)}) 
      could not be set: ${error}`);
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
      // If lockStatus is true (locked) or 4 (LOCKED)
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