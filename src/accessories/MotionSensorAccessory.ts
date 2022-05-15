import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Device, MotionSensor, PropertyName } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class MotionSensorAccessory extends DeviceAccessory {

  protected service: Service;
  protected MotionSensor: MotionSensor;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: MotionSensor,
  ) {
    super(platform, accessory, eufyDevice);

    this.platform.log.debug(this.accessory.displayName, 'Constructed Motion Sensor');

    this.MotionSensor = eufyDevice;

    this.service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      this.accessory.displayName,
    );

    try {
      if (this.eufyDevice.hasProperty('motionDetected')) {
        this.platform.log.debug(this.accessory.displayName, 'has a motionDetected, so append MotionDetected characteristic to him.');

        // create handlers for required characteristics
        this.service
          .getCharacteristic(this.platform.Characteristic.MotionDetected)
          .onGet(this.handleMotionDetectedGet.bind(this));

        this.MotionSensor.on('motion detected', (device: Device, motion: boolean) =>
          this.onDeviceMotionDetectedPushNotification(device, motion),
        );

      } else {
        this.platform.log.warn(this.accessory.displayName, 'has no motionDetected');
      }
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach a motionDetected.', Error);
    }
  }

  async handleMotionDetectedGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = this.MotionSensor.getPropertyValue(PropertyName.DeviceMotionDetected);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceMotionDetected:', currentValue);
      return currentValue as boolean;
    } catch {
      this.platform.log.error(this.accessory.displayName, 'handleMotionDetectedGet', 'Wrong return value');
      return false;
    }
  }

  private onDeviceMotionDetectedPushNotification(
    device: Device,
    motion: boolean,
  ): void {
    this.platform.log.debug(this.accessory.displayName, 'Handle Camera motion:', motion);
    this.service
      .getCharacteristic(this.characteristic.MotionDetected)
      .updateValue(motion);
  }
}
