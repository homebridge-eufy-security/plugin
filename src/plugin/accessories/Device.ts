import {
  PlatformAccessory,
  Characteristic,
  CharacteristicValue,
  Service,
  WithUUID,
} from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { BaseAccessory } from './BaseAccessory';
import { Device, PropertyName } from 'eufy-security-client';

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
  }

  /**
   * Get the current value of the "propertyName" characteristic
   */
  protected getPropertyValue(characteristic: string, propertyName: PropertyName): CharacteristicValue {
    try {
      const value = this.device.getPropertyValue(propertyName);
      this.log.debug(`${this.accessory.displayName} GET '${characteristic}' ${propertyName}: ${value}`);
      return value as CharacteristicValue;
    } catch (error) {
      this.log.debug(`${this.accessory.displayName} Error getting '${characteristic}' ${propertyName}: ${error}`);
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
    this.log.debug(`${this.accessory.displayName} ON '${serviceType.name}': ${value}`);
    this.getService(serviceType)
      .getCharacteristic(characteristicType)
      .updateValue(value);
  }

  initSensorService(serviceType: ServiceType) {
    const propertiesToRegister = [
      {
        property: 'battery',
        characteristicType: this.platform.Characteristic.BatteryLevel,
        propertyName: PropertyName.DeviceBattery,
        onSimpleValue: null,
      },
      {
        property: 'batteryLow',
        characteristicType: this.platform.Characteristic.StatusLowBattery,
        propertyName: PropertyName.DeviceBatteryLow,
        onSimpleValue: 'low battery',
      },
      {
        property: 'batteryIsCharging',
        characteristicType: this.platform.Characteristic.ChargingState,
        propertyName: PropertyName.DeviceBatteryIsCharging,
        onSimpleValue: null,
      },
    ];

    propertiesToRegister.forEach((propertyConfig) => {
      if (this.device.hasProperty(propertyConfig.property)) {
        this.registerCharacteristic({
          serviceType: serviceType,
          characteristicType: propertyConfig.characteristicType,
          getValue: (data) => this.device.getPropertyValue(propertyConfig.propertyName),
          onSimpleValue: propertyConfig.onSimpleValue,
        });
      }
    });
  }
}