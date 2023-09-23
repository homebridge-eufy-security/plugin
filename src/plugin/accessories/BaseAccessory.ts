import {
  PlatformAccessory,
  Characteristic,
  CharacteristicValue,
  Service,
  WithUUID,
} from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { DeviceType, DeviceEvents, PropertyValue, Device, Station, StationEvents, PropertyName } from 'eufy-security-client';
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

    this.logPropertyKeys();
  }

  // Function to extract and log keys
  private logPropertyKeys() {
    const properties = this.device.getProperties();
    const keys = Object.keys(properties).join(', ');
    this.platform.log.debug(`${this.accessory.displayName} Property Keys: ${keys}`);
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
    onMultipleValue,
    name,
    serviceSubType,
    setValueDebounceTime = 0,
  }: {
    characteristicType: CharacteristicType;
    serviceType: ServiceType;
    serviceSubType?: string;
    name?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getValue?: (data: any, characteristic?: Characteristic, service?: Service) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setValue?: (value: any, characteristic?: Characteristic, service?: Service) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onValue?: (service: Service, characteristic: Characteristic) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSimpleValue?: any;
    onMultipleValue?: (keyof DeviceEvents | StationEvents)[];
    setValueDebounceTime?: number;
  }) {
    const service = this.getService(serviceType, name, serviceSubType);
    const characteristic = service.getCharacteristic(characteristicType);

    // eslint-disable-next-line max-len
    this.platform.log.debug(`${this.accessory.displayName} REGISTER SERVICE '${serviceType.name} / ${characteristic.displayName}': ${characteristic.UUID}`);

    if (getValue) {
      characteristic.onGet(async (data) => {
        const value = getValue(data, characteristic, service);
        this.platform.log.debug(`${this.accessory.displayName} GET '${serviceType.name} / ${characteristicType.name}': ${value}`);
        return value;
      });
    }

    if (setValue && setValueDebounceTime) {

      let timeoutId: NodeJS.Timeout | null = null;
      
      characteristic.onSet(async (value: CharacteristicValue) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      
        timeoutId = setTimeout(() => {
          timeoutId = null;
          setValue(value, characteristic, service);
        }, setValueDebounceTime);
      });

    } else if (setValue) {
      characteristic.onSet(async (value: CharacteristicValue) => {
        Promise.resolve(setValue(value, characteristic, service));
      });
    }

    if (onSimpleValue) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.device.on(onSimpleValue, (device: any, value: any) => {
        // eslint-disable-next-line max-len
        this.platform.log.info(`${this.accessory.displayName} ON '${serviceType.name} / ${characteristicType.name} / ${onSimpleValue}': ${value}`);
        characteristic.updateValue(value);
      });
    }

    if (onValue) {
      this.platform.log.debug(`${this.accessory.displayName} ON '${serviceType.name} / ${characteristicType.name}'`);
      onValue(service, characteristic);
    }

    if (onMultipleValue) {
      // Attach the common event handler to each event type
      onMultipleValue.forEach(eventType => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.device.on(eventType as keyof any, (device: any, value: any) => {
          // eslint-disable-next-line max-len
          this.platform.log.info(`${this.accessory.displayName} ON '${serviceType.name} / ${characteristicType.name} / ${eventType}': ${value}`);
          characteristic.updateValue(value);
        });
      });
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