
import { PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { Device, DeviceType, PropertyName, PropertyValue } from 'eufy-security-client';

export abstract class DeviceAccessory {

  protected eufyDevice: Device;
  protected platform: EufySecurityPlatform;
  protected accessory: PlatformAccessory;
  protected characteristic;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: Device,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.eufyDevice = eufyDevice;

    this.characteristic = this.platform.Characteristic;

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.characteristic.Manufacturer, 'Eufy')
      .setCharacteristic(
        this.characteristic.Model,
        DeviceType[this.eufyDevice.getDeviceType()],
      )
      .setCharacteristic(
        this.characteristic.SerialNumber,
        this.eufyDevice.getSerial(),
      )
      .setCharacteristic(
        this.characteristic.FirmwareRevision,
        this.eufyDevice.getSoftwareVersion(),
      )
      .setCharacteristic(
        this.characteristic.HardwareRevision,
        this.eufyDevice.getHardwareVersion(),
      );

    try {
      if (this.eufyDevice.hasProperty('battery') || this.eufyDevice.hasProperty('batteryLow')) {

        const batteryService =
          this.accessory.getService(this.platform.Service.Battery) ||
          this.accessory.addService(this.platform.Service.Battery);

        batteryService.setCharacteristic(
          this.characteristic.Name,
          accessory.displayName,
        );

        // create handlers for required characteristics of Battery service
        if (this.eufyDevice.hasProperty('battery')) {
          this.platform.log.debug(this.accessory.displayName, 'has a battery, so append Battery characteristic to him.');
          batteryService
            .getCharacteristic(this.characteristic.BatteryLevel)
            .onGet(this.handleBatteryLevelGet.bind(this));
        } else {
          this.platform.log.debug(this.accessory.displayName, 'has a batteryLow, so append StatusLowBattery characteristic to him.');
          batteryService
            .getCharacteristic(this.characteristic.StatusLowBattery)
            .onGet(this.handleStatusLowBatteryGet.bind(this));
        }

      } else {
        this.platform.log.debug(this.accessory.displayName, 'has no battery');
      }
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach a battery.', Error);
    }

    if (this.platform.config.enableDetailedLogging) {
      this.eufyDevice.on('raw property changed', (device: Device, type: number, value: string) =>
        this.handleRawPropertyChange(device, type, value),
      );
      this.eufyDevice.on('property changed', (device: Device, name: string, value: PropertyValue) =>
        this.handlePropertyChange(device, name, value),
      );
    }
  }

  protected handleRawPropertyChange(
    device: Device,
    type: number,
    value: string,
  ): void {
    this.platform.log.debug(
      this.accessory.displayName,
      'Raw Property Changes:',
      type,
      value,
    );
  }

  protected handlePropertyChange(
    device: Device,
    name: string,
    value: PropertyValue,
  ): void {
    this.platform.log.debug(
      this.accessory.displayName,
      'Property Changes:',
      name,
      value,
    );
  }

  /**
   * Handle requests to get the current value of the "Status Low Battery" characteristic
   */
  async handleStatusLowBatteryGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = await this.eufyDevice.getPropertyValue(PropertyName.DeviceBatteryLow);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceBatteryLow:', currentValue);
      return currentValue as boolean;
    } catch {
      this.platform.log.error(this.accessory.displayName, 'handleStatusLowBatteryGet', 'Wrong return value');
      return false;
    }
  }

  /**
   * Handle requests to get the current value of the "Battery Level" characteristic
   */
  async handleBatteryLevelGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = this.eufyDevice.getPropertyValue(PropertyName.DeviceBattery);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceBattery:', currentValue);
      return currentValue as number;
    } catch {
      this.platform.log.error(this.accessory.displayName, 'handleBatteryLevelGet', 'Wrong return value');
      return 0;
    }
  }
}