import { Service, PlatformAccessory } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Device, EntrySensor, DeviceType } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class EntrySensorAccessory extends DeviceAccessory {
  
  protected service: Service;
  protected EntrySensor: EntrySensor;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: EntrySensor,
  ) {
    super(platform, accessory, eufyDevice);
    this.EntrySensor = eufyDevice;
    
    this.platform.log.debug(this.accessory.displayName, 'Constructed Entry Sensor');

    this.service =
      this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      this.accessory.displayName,
    );

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .on('get', this.handleSecuritySystemCurrentStateGet.bind(this));

    this.EntrySensor.on('open', (device: Device, open: boolean) =>
      this.onDeviceOpenPushNotification(device, open),
    );
  }

  async getCurrentStatus() {
    const isSensorOpen = this.EntrySensor.isSensorOpen();
    return isSensorOpen.value;
  }

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleSecuritySystemCurrentStateGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET SecuritySystemCurrentState');

    // set this to a valid value for SecuritySystemCurrentState
    const currentValue = await this.getCurrentStatus();
    this.platform.log.debug(this.accessory.displayName, 'Handle Current System state:  -- ', currentValue);

    callback(null, currentValue);
  }

  private onDeviceOpenPushNotification(device: Device, open: boolean): void {
    this.service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .updateValue(open);
  }
}
