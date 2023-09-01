import {
  PlatformAccessory,
  Characteristic,
  CharacteristicValue,
  Service,
  WithUUID,
} from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { DeviceType, PropertyValue, Device, Station } from 'eufy-security-client';
import { EventEmitter } from 'events';

function isServiceInstance(
  serviceType: WithUUID<typeof Service> | Service,
): serviceType is Service {
  // eslint-disable-next-line
  return typeof (serviceType as any) === 'object';
}

export type CharacteristicType = WithUUID<{ new(): Characteristic }>;
export type ServiceType = WithUUID<typeof Service> | Service;

export abstract class BaseAccessory extends EventEmitter {

  protected servicesInUse: Service[] = [];
  protected SN: string;

  constructor(
    protected platform: EufySecurityPlatform,
    protected accessory: PlatformAccessory,
    // eslint-disable-next-line
    protected device: any,
  ) {
    super();

    this.platform = platform;
    this.accessory = accessory;
    this.device = device as Device | Station;

    this.SN = this.device.getSerial();

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
      getValue: (data) => this.SN || 'Unknowm',
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.device.on('raw property changed', (device: any, type: number, value: string) =>
        this.handleRawPropertyChange(device, type, value),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.device.on('property changed', (device: any, name: string, value: PropertyValue) =>
        this.handlePropertyChange(device, name, value),
      );
    }

  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected handleRawPropertyChange(device: any, type: number, value: string): void {
    this.platform.log.debug(`${this.accessory.displayName} Raw Property Changes: ${type} ${value}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected handlePropertyChange(device: any, name: string, value: PropertyValue): void {
    this.platform.log.debug(`${this.accessory.displayName} Property Changes: ${name} ${value}`);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getValue: (data: any) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setValue?: (value: any) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onValue?: (service: Service, characteristic: Characteristic) => any;
    onSimpleValue?: string;
  }) {
    const service = this.getService(serviceType, name, serviceSubType);
    const characteristic = service.getCharacteristic(characteristicType);

    // eslint-disable-next-line max-len
    this.platform.log.debug(`${this.accessory.displayName} REGISTER SERVICE '${serviceType.name} / ${characteristic.displayName}': ${characteristic.UUID}`);

    characteristic.onGet(async (data) => {
      const value = getValue(data);
      this.platform.log.debug(`${this.accessory.displayName} GET '${serviceType.name} / ${characteristicType.name}': ${value}`);
      return value;
    });

    if (setValue) {
      characteristic.onSet(async (value: CharacteristicValue) => {
        this.platform.log.debug(`${this.accessory.displayName} SET '${serviceType.name} / ${characteristicType.name}': ${value}`);
        Promise.resolve(setValue(value));
      });
    }

    if (onSimpleValue) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.device.on(onSimpleValue as keyof any, (device: any, state: any) => {
        // eslint-disable-next-line max-len
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