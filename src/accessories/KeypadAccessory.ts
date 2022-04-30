import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Keypad, PropertyName } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class KeypadAccessory extends DeviceAccessory {

  protected service: Service;
  protected Keypad: Keypad;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: Keypad,
  ) {
    super(platform, accessory, eufyDevice);
    this.Keypad = eufyDevice;

    this.platform.log.debug(this.accessory.displayName, 'Constructed Keypad');
    // set accessory information

    this.service =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handleOnGet.bind(this))
      .on('set', this.handleOnSet.bind(this));

  }

  async getCurrentDeviceState() {
    const state = this.Keypad.getState();

    return state as number;
  }

  /**
   * Handle requests to get the current value of the "Active" characteristic
   */
  async handleOnGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET Active');

    const currentDeviceState = await this.getCurrentDeviceState();

    // set this to a valid value for Active
    const currentValue = currentDeviceState === 1 ? 1 : 0;

    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  async handleOnSet(value, callback) {
    const currentDeviceState = await this.getCurrentDeviceState();

    // set this to a valid value for Active
    const currentValue = currentDeviceState === 1 ? 1 : 0;

    this.service.updateCharacteristic(
      this.platform.Characteristic.SecuritySystemCurrentState,
      currentValue,
    );

    callback(null);
  }
}
