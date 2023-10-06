import { PlatformAccessory } from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { MotionSensor, PropertyName } from '@homebridge-eufy-security/eufy-security-client';

/**
 * MotionSensorAccessory Class
 *
 * This class represents a motion sensor accessory within a home automation system. It is designed
 * to integrate motion sensors into the system, register appropriate characteristics, and provide
 * necessary functionality for motion detection.
 *
 * @class MotionSensorAccessory
 * @extends DeviceAccessory
 */
export class MotionSensorAccessory extends DeviceAccessory {

  /**
   * Constructor for MotionSensorAccessory.
   *
   * @param {EufySecurityPlatform} platform - The platform instance managing accessories.
   * @param {PlatformAccessory} accessory - The platform-specific accessory.
   * @param {MotionSensor} device - The motion sensor device being represented.
   */
  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: MotionSensor,
  ) {
    // Call the constructor of the parent class DeviceAccessory.
    super(platform, accessory, device);

    // Log a debug message indicating the construction of the Motion Sensor.
    this.log.debug(`${this.accessory.displayName} Constructed Motion Sensor`);

    // Check if the device has the 'motionDetected' property.
    if (this.device.hasProperty('motionDetected')) {

      // Register the Motion Detected characteristic.
      this.registerCharacteristic({
        serviceType: this.platform.Service.MotionSensor,
        characteristicType: this.platform.Characteristic.MotionDetected,
        getValue: (data) => this.device.getPropertyValue(PropertyName.DeviceMotionDetected),
        onSimpleValue: 'motion detected',
      });

      // Initialize the sensor service.
      this.initSensorService(this.platform.Service.MotionSensor);

    } else {
      // Log an error if the 'motionDetected' property is not available for this device.
      this.log.error(`${this.accessory.displayName} has no motionDetected`);
    }

    // Remove any unused services.
    this.pruneUnusedServices();
  }
}