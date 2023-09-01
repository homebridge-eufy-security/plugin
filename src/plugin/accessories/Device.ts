import {
  PlatformAccessory,
  Characteristic,
  CharacteristicValue,
  Service,
  WithUUID,
} from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { BaseAccessory } from './BaseAccessory';
import { Device, DeviceType, PropertyName, PropertyValue } from 'eufy-security-client';

function isServiceInstance(
  serviceType: WithUUID<typeof Service> | Service,
): serviceType is Service {
  // eslint-disable-next-line
  return typeof (serviceType as any) === 'object';
}

export type CharacteristicType = WithUUID<{ new(): Characteristic }>;
export type ServiceType = WithUUID<typeof Service> | Service;

export abstract class DeviceAccessory extends BaseAccessory {

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: Device,
  ) {
    super(platform, accessory, device);

    this.pruneUnusedServices();
  }

  /**
   * Get the current value of the "propertyName" characteristic
   */
  protected getPropertyValue(characteristic: string, propertyName: PropertyName): CharacteristicValue {
    try {
      const value = this.device.getPropertyValue(propertyName);
      this.platform.log.debug(`${this.accessory.displayName} GET '${characteristic}' ${propertyName}: ${value}`);
      return value as CharacteristicValue;
    } catch (error) {
      this.platform.log.debug(`${this.accessory.displayName} Error getting '${characteristic}' ${propertyName}: ${error}`);
      return false;
    }
  }

  protected async setPropertyValue(propertyName: PropertyName, value: unknown) {
    await this.platform.eufyClient.setDeviceProperty(this.SN, propertyName, value);
  }

  protected onPushNotification(
    characteristicType: CharacteristicType,
    serviceType: ServiceType,
    value: CharacteristicValue,
    subType?: string,
  ): void {
    this.platform.log.debug(`${this.accessory.displayName} ON '${serviceType.name}': ${value}`);
    this.getService(serviceType)
      .getCharacteristic(characteristicType)
      .updateValue(value);
  }

  initSensorService(serviceType: ServiceType) {

    if (this.device.hasProperty('battery')) {
      this.registerCharacteristic({
        serviceType: serviceType,
        characteristicType: this.platform.Characteristic.BatteryLevel,
        getValue: (data) => this.device.getPropertyValue(PropertyName.DeviceBattery),
      });
    } else if (this.device.hasProperty('batteryLow')) {
      this.registerCharacteristic({
        serviceType: serviceType,
        characteristicType: this.platform.Characteristic.StatusLowBattery,
        getValue: (data) => this.device.getPropertyValue(PropertyName.DeviceBatteryLow),
        onSimpleValue: 'low battery',
      });
    } else {
      this.platform.log.debug(`${this.accessory.displayName} has no battery`);
    }
  }
}