
import { PlatformAccessory } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { Device, DeviceType, PropertyValue } from 'eufy-security-client';

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

    if (this.platform.config.enableDetailedLogging) {
      this.eufyDevice.on('raw property changed', (device: Device, type: number, value: string, modified: number) =>
        this.handleRawPropertyChange(device, type, value, modified),
      );
      this.eufyDevice.on('property changed', (device: Device, name: string, value: PropertyValue) =>
        this.handlePropertyChange(device, name, value),
      );
    }
  }

  private handleRawPropertyChange(
    device: Device,
    type: number,
    value: string,
    modified: number,
  ): void {
    this.platform.log.info(
      this.accessory.displayName,
      'Raw Property Changes:  -- ',
      type,
      value,
      modified,
    );
  }

  private handlePropertyChange(
    device: Device,
    name: string,
    value: PropertyValue,
  ): void {
    this.platform.log.info(
      this.accessory.displayName,
      'Property Changes:  -- ',
      name,
      value,
    );
  }
}