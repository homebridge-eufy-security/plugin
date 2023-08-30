import { PlatformAccessory } from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { MotionSensor, PropertyName } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class MotionSensorAccessory extends DeviceAccessory {

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: MotionSensor,
  ) {
    super(platform, accessory, device);

    this.platform.log.debug(`${this.accessory.displayName} Constructed Motion Sensor`);

    if (this.device.hasProperty('motionDetected')) {

      this.registerCharacteristic({
        serviceType: this.platform.Service.MotionSensor,
        characteristicType: this.platform.Characteristic.MotionDetected,
        getValue: (data) => this.device.getPropertyValue(PropertyName.DeviceMotionDetected),
        onSimpleValue: 'motion detected',
      });

      this.initSensorService(this.platform.Service.MotionSensor);

    } else {
      this.platform.log.warn(`${this.accessory.displayName} has no motionDetected`);
      throw Error(`${this.accessory.displayName} raise error to check and attach a motionDetected: ${Error}`);
    }
  }
}