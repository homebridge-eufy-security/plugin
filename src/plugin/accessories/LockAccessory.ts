/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore
import { CharacteristicValue, PlatformAccessory } from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';
import { Lock, PropertyName } from 'eufy-security-client';
import { CHAR, SERV, log } from '../utils/utils';

/**
 * LockAccessory Class
 *
 * This class represents a lock accessory within a home automation system. It is designed to
 * integrate smart locks into the system, register appropriate HomeKit characteristics, and provide
 * functionality for controlling and monitoring the lock's status.
 *
 * @class LockAccessory
 * @extends DeviceAccessory
 */
export class LockAccessory extends DeviceAccessory {

  /**
   * Constructor for LockAccessory.
   *
   * @param {EufySecurityPlatform} platform - The platform instance managing accessories.
   * @param {PlatformAccessory} accessory - The platform-specific accessory.
   * @param {Lock} device - The lock device being represented.
   */
  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: Lock,
  ) {
    // Call the constructor of the parent class DeviceAccessory.
    super(platform, accessory, device);

    // Log that the LockAccessory is constructed.
    log.debug(`${this.accessory.displayName} Constructed Lock`);

    // Check if the device has the 'locked' property.
    if (this.device.hasProperty('locked')) {
      // Initialize Lock Management Service characteristics.
      this.initLockManagementService();

      // Initialize Lock Mechanism Service characteristics.
      this.initLockMechanismService();
    } else {
      // Log an error if the device has no lock.
      log.error(`${this.accessory.displayName} has no lock`);
    }

    // Prune any unused services.
    this.pruneUnusedServices();
  }

  /**
   * Initializes characteristics for the Lock Management Service.
   */
  private initLockManagementService() {
    // Register Lock Management Service characteristics.
    // Version characteristic (always returns '1.0').
    this.registerCharacteristic({
      serviceType: SERV.LockManagement,
      characteristicType: CHAR.Version,
      getValue: () => '1.0',
    });

    // LockManagementAutoSecurityTimeout characteristic (always returns 3 seconds).
    this.registerCharacteristic({
      serviceType: SERV.LockManagement,
      characteristicType: CHAR.LockManagementAutoSecurityTimeout,
      getValue: () => 3,
    });

    // AdministratorOnlyAccess characteristic (always returns true).
    this.registerCharacteristic({
      serviceType: SERV.LockManagement,
      characteristicType: CHAR.AdministratorOnlyAccess,
      getValue: () => true,
    });

    // LockControlPoint characteristic (no initial value).
    this.registerCharacteristic({
      serviceType: SERV.LockManagement,
      characteristicType: CHAR.LockControlPoint,
    });
  }

  /**
   * Initializes characteristics for the Lock Mechanism Service.
   */
  private initLockMechanismService() {
    // Register Lock Mechanism Service characteristics.
    // LockCurrentState and LockTargetState characteristics.
    this.registerCharacteristic({
      serviceType: SERV.LockMechanism,
      characteristicType: CHAR.LockCurrentState,
      getValue: () => this.getLockStatus(),
      onValue: (service, characteristic) => {
        this.device.on('locked', () => {
          characteristic.updateValue(this.getLockStatus());
        });
      },
    });

    this.registerCharacteristic({
      serviceType: SERV.LockMechanism,
      characteristicType: CHAR.LockTargetState,
      getValue: () => this.getLockStatus(),
      setValue: async (value) => {
        try {
          await this.setLockTargetState(value);
        } catch (error) {
          log.error(`${this.accessory.displayName} Lock target state could not be set: ${error}`);
        }
      },
      onValue: (service, characteristic) => {
        this.device.on('locked', () => {
          characteristic.updateValue(this.getLockStatus());
        });
      },
    });

    // Initialize the sensor service.
    this.initSensorService(SERV.LockMechanism);
  }

  /**
   * Gets the lock status and maps it to HomeKit lock states.
   */
  private getLockStatus(): CharacteristicValue {
    const lockStatus = this.device.getPropertyValue(PropertyName.DeviceLocked);
    log.debug(`${this.accessory.displayName} getLockStatus: ${lockStatus}`);
    return this.convertLockStatusCode(lockStatus);
  }

  /**
   * Sets the lock target state asynchronously.
   */
  private async setLockTargetState(state: CharacteristicValue) {
    try {
      await this.setPropertyValue(PropertyName.DeviceLocked, !!state);
      log.info(`${this.accessory.displayName} Lock target state set to: ${state}`);
    } catch (error) {
      log.error(`${this.accessory.displayName} Error setting lock target state: ${error}`);
    }
  }

  /**
   * Converts lock status codes to corresponding HomeKit lock states.
   */
  private convertLockStatusCode(lockStatus: number): CharacteristicValue {
    // Define a mapping object for lock status codes to HomeKit states
    const lockStatusMap: Record<number, CharacteristicValue> = {
      4: CHAR.LockCurrentState.SECURED,
      3: CHAR.LockCurrentState.UNSECURED,
      5: CHAR.LockCurrentState.JAMMED,
    };

    // Check if the lock status code is in the mapping, otherwise, return UNKNOWN
    const mappedState = lockStatusMap[lockStatus];

    if (mappedState !== undefined) {
      log.debug(`${this.accessory.displayName} LockStatus: ${lockStatus}`);
      return mappedState;
    } else {
      log.warn(`${this.accessory.displayName} Unknown lock status feedback`);
      return CHAR.LockCurrentState.UNKNOWN;
    }
  }
}