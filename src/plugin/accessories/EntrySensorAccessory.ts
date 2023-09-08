import { PlatformAccessory } from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { EntrySensor, PropertyName } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class EntrySensorAccessory extends DeviceAccessory {

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: EntrySensor,
  ) {
    super(platform, accessory, device);

    this.platform.log.debug(`${this.accessory.displayName} Constructed Entry Sensor`);

    if (this.device.hasProperty('sensorOpen')) {

      this.registerCharacteristic({
        serviceType: this.platform.Service.ContactSensor,
        characteristicType: this.platform.Characteristic.ContactSensorState,
        getValue: (data) => this.device.getPropertyValue(PropertyName.DeviceSensorOpen),
        onSimpleValue: 'open',
      });

      this.initSensorService(this.platform.Service.ContactSensor);

    } else {
      this.platform.log.error(`${this.accessory.displayName} has no sensorOpen`);
    }
  }
}