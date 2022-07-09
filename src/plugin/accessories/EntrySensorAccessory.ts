import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Device, EntrySensor, PropertyName } from 'eufy-security-client';

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

    this.platform.log.debug(this.accessory.displayName, 'Constructed Entry Sensor');

    this.EntrySensor = eufyDevice;

    this.service =
      this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      this.accessory.displayName,
    );

    try {
      if (this.eufyDevice.hasProperty('sensorOpen')) {
        this.platform.log.debug(this.accessory.displayName, 'has a sensorOpen, so append ContactSensorState characteristic to him.');

        // create handlers for required characteristics
        this.service
          .getCharacteristic(this.platform.Characteristic.ContactSensorState)
          .onGet(this.handleContactSensorStateGet.bind(this));

        this.EntrySensor.on('open', (device: Device, open: boolean) =>
          this.onDeviceOpenPushNotification(device, open),
        );

      } else {
        this.platform.log.warn(this.accessory.displayName, 'has no sensorOpen');
      }
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach a sensorOpen.', Error);
    }
  }

  async handleContactSensorStateGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = this.EntrySensor.getPropertyValue(PropertyName.DeviceSensorOpen);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceSensorOpen:', currentValue);
      return currentValue as boolean;
    } catch {
      this.platform.log.error(this.accessory.displayName, 'handleContactSensorStateGet', 'Wrong return value');
      return false;
    }
  }

  private onDeviceOpenPushNotification(
    device: Device,
    open: boolean,
  ): void {
    this.platform.log.debug(this.accessory.displayName, 'Handle Motion Sensor:', open);
    this.service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .updateValue(open);
  }
}
