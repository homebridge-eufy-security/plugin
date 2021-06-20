import { Service, PlatformAccessory } from 'homebridge';

import { EufySecurityPlatform } from './platform';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

import { Device, MotionSensor, DeviceType } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SecurityMotionSensorAccessory {
  private service: Service;

  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly accessory: PlatformAccessory,
    private eufyDevice: MotionSensor,
  ) {
    this.platform.log.debug(this.accessory.displayName, 'Constructed Motion Sensor');
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Eufy')
      .setCharacteristic(
        this.platform.Characteristic.Model,
        DeviceType[eufyDevice.getDeviceType()],
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        eufyDevice.getSerial(),
      )
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        eufyDevice.getSoftwareVersion(),
      )
      .setCharacteristic(
        this.platform.Characteristic.HardwareRevision,
        eufyDevice.getHardwareVersion(),
      );

    this.service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .on('get', this.handleMotionDetectedGet.bind(this));

    this.eufyDevice.on('motion detected', (device: Device, open: boolean) =>
      this.onDeviceMotionDetectedPushNotification(device, open),
    );
  }

  async isMotionDetected() {
    const isMotionDetected = this.eufyDevice.isMotionDetected();
    return isMotionDetected as boolean;
  }

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleMotionDetectedGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET MotionDetected');

    const currentValue = await this.isMotionDetected();
    this.platform.log.debug(this.accessory.displayName, 'Handle Motion Sensor:  -- ', currentValue);

    callback(null, currentValue as boolean);
  }

  private onDeviceMotionDetectedPushNotification(
    device: Device,
    open: boolean,
  ): void {
    this.service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .updateValue(open);
  }
}
