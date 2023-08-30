import {
  PlatformAccessory,
  Characteristic,
  CharacteristicValue,
  Service,
  WithUUID,
} from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { Device, DeviceType, DeviceEvents, PropertyName, PropertyValue } from 'eufy-security-client';
import { EventEmitter } from 'events';

function isServiceInstance(
  serviceType: WithUUID<typeof Service> | Service,
): serviceType is Service {
  // eslint-disable-next-line
  return typeof (serviceType as any) === 'object';
}

export type CharacteristicType = WithUUID<{ new(): Characteristic }>;
export type ServiceType = WithUUID<typeof Service> | Service;

export abstract class DeviceAccessory extends EventEmitter {

  protected service: Service;
  protected servicesInUse: Service[] = [];

  constructor(
    public readonly platform: EufySecurityPlatform,
    public readonly accessory: PlatformAccessory,
    public device: Device,
  ) {
    super();

    this.platform = platform;
    this.accessory = accessory;
    this.device = device;

    this.service = {} as Service;
  }

  protected initBase() {

    this.registerCharacteristic({
      serviceType: this.platform.Service.AccessoryInformation,
      characteristicType: this.platform.Characteristic.Manufacturer,
      getValue: (data) => 'Eufy',
    });
    this.registerCharacteristic({
      serviceType: this.platform.Service.AccessoryInformation,
      characteristicType: this.platform.Characteristic.Name,
      getValue: (data) => this.accessory.displayName || 'Unknowm',
    });
    this.registerCharacteristic({
      serviceType: this.platform.Service.AccessoryInformation,
      characteristicType: this.platform.Characteristic.Model,
      getValue: (data) => DeviceType[this.device.getDeviceType()] || 'Unknowm',
    });
    this.registerCharacteristic({
      serviceType: this.platform.Service.AccessoryInformation,
      characteristicType: this.platform.Characteristic.SerialNumber,
      getValue: (data) => this.device.getSerial() || 'Unknowm',
    });
    this.registerCharacteristic({
      serviceType: this.platform.Service.AccessoryInformation,
      characteristicType: this.platform.Characteristic.FirmwareRevision,
      getValue: (data) => this.device.getSoftwareVersion() || 'Unknowm',
    });
    this.registerCharacteristic({
      serviceType: this.platform.Service.AccessoryInformation,
      characteristicType: this.platform.Characteristic.HardwareRevision,
      getValue: (data) => this.device.getHardwareVersion() || 'Unknowm',
    });

    if (this.platform.config.enableDetailedLogging) {
      this.device.on('raw property changed', (device: Device, type: number, value: string) =>
        this.handleRawPropertyChange(device, type, value),
      );
      this.device.on('property changed', (device: Device, name: string, value: PropertyValue) =>
        this.handlePropertyChange(device, name, value),
      );
    }

    this.pruneUnusedServices();
  }

  protected handleRawPropertyChange(
    device: Device,
    type: number,
    value: string,
  ): void {
    this.platform.log.debug(`${this.accessory.displayName} 'Raw Property Changes:' ${type} ${value}`);
  }

  protected handlePropertyChange(
    device: Device,
    name: string,
    value: PropertyValue,
  ): void {
    this.platform.log.debug(`${this.accessory.displayName} 'Property Changes:' ${name} ${value}`);
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

  /**
   * Get the current value of the "propertyName" characteristic
   */
  protected setPropertyValue(characteristic: string, propertyName: PropertyName, value: CharacteristicValue) {
    // eslint-disable-next-line max-len
    this.platform.log.debug(`${this.accessory.displayName} SET '${typeof characteristic} / ${characteristic}' ${propertyName}: ${value}`);
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

  registerCharacteristic({
    characteristicType,
    serviceType,
    getValue,
    setValue,
    onValue,
    onSimpleValue,
    name,
    serviceSubType,
  }: {
    characteristicType: CharacteristicType;
    serviceType: ServiceType;
    serviceSubType?: string;
    name?: string;
    // eslint-disable-next-line
    getValue: (data: any) => any;
    // eslint-disable-next-line
    setValue?: (data: any) => any;
    // eslint-disable-next-line
    onValue?: (service: Service, characteristic: Characteristic) => any;
    onSimpleValue?: string;
  }) {
    const service = this.getService(serviceType, name, serviceSubType);
    const characteristic = service.getCharacteristic(characteristicType);

    // eslint-disable-next-line max-len
    this.platform.log.debug(`${this.accessory.displayName} REGISTER SERVICE '${serviceType.name} / ${characteristic.displayName}': ${characteristic.UUID}`);

    if (getValue) {
      // Only register for GET if an async request should be made to get an updated value
      characteristic.onGet(async (data) => {
        const value = getValue(data);
        this.platform.log.debug(`${this.accessory.displayName} GET '${serviceType.name} / ${characteristicType.name}': ${value}`);
        return value;
      });
    }

    if (setValue) {
      characteristic.onSet(async (value) => {
        setValue.bind(value);
        this.platform.log.debug(`${this.accessory.displayName} SET '${serviceType.name} / ${characteristicType.name}': ${setValue}`);
      });
    }

    if (onSimpleValue) {
      // eslint-disable-next-line
      this.device.on(onSimpleValue as keyof DeviceEvents, (device: Device, state: any) => {
        // eslint-disable-next-line
        this.platform.log.info(`${this.accessory.displayName} ON '${serviceType.name} / ${characteristicType.name} / ${onSimpleValue}': ${state}`);
        characteristic.updateValue(state);
      });
    } else if (onValue) {
      onValue(service, characteristic);
    }
  }

  protected getService(
    serviceType: ServiceType,
    name = this.accessory.displayName,
    subType?: string,
  ): Service {

    if (isServiceInstance(serviceType)) {
      return serviceType;
    }

    const existingService = subType ? this.accessory.getServiceById(serviceType, subType) : this.accessory.getService(serviceType);

    const service = existingService ||
      this.accessory.addService(serviceType, name, subType!);

    if (
      existingService &&
      existingService.displayName &&
      name !== existingService.displayName
    ) {
      throw new Error(
        `Overlapping services for device ${this.accessory.displayName} - ${name} != ${existingService.displayName} - ${serviceType}`,
      );
    }

    if (!this.servicesInUse.includes(service)) {
      this.servicesInUse.push(service);
    }

    return service;
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

  pruneUnusedServices() {
    const safeServiceUUIDs = [
      this.platform.Service.CameraRTPStreamManagement.UUID,
    ];

    this.accessory.services.forEach((service) => {
      if (
        !this.servicesInUse.includes(service) &&
        !safeServiceUUIDs.includes(service.UUID)
      ) {
        // eslint-disable-next-line max-len
        this.platform.log.debug(`${this.accessory.displayName} Pruning unused service ${service.UUID} ${service.displayName || service.name}`);
        this.accessory.removeService(service);
      }
    });
  }
}