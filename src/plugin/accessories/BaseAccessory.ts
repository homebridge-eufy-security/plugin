import {
  PlatformAccessory,
  Characteristic,
  CharacteristicValue,
  Service,
  WithUUID,
  HAP,
} from 'homebridge';
import { EufySecurityPlatform } from '../platform';
import { DeviceType, DeviceEvents, PropertyValue, Device, Station, StationEvents } from '@homebridge-eufy-security/eufy-security-client';
import { EventEmitter } from 'events';
import { Logger as TsLogger, ILogObj } from 'tslog';

/**
 * Determine if the serviceType is an instance of Service.
 *
 * @param {WithUUID<typeof Service> | Service} serviceType - The service type to be checked.
 * @returns {boolean} Returns true if the serviceType is an instance of Service, otherwise false.
 */
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
  public readonly SN: string;
  public readonly name: string;
  public readonly log: TsLogger<ILogObj> = this.platform.log;
  public readonly hap: HAP = this.platform.api.hap;

  constructor(
    public readonly platform: EufySecurityPlatform,
    public readonly accessory: PlatformAccessory,
    // eslint-disable-next-line
    public device: any,
  ) {
    super();

    this.platform = platform;
    this.accessory = accessory;
    this.device = device as Device | Station;

    this.SN = this.device.getSerial();
    this.name = this.device.getName();

    this.registerCharacteristic({
      serviceType: this.platform.Service.AccessoryInformation,
      characteristicType: this.platform.Characteristic.Manufacturer,
      getValue: (data) => 'Eufy',
    });
    this.registerCharacteristic({
      serviceType: this.platform.Service.AccessoryInformation,
      characteristicType: this.platform.Characteristic.Name,
      getValue: (data) => this.name || 'Unknowm',
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
    this.log.debug(`${this.name} Property Keys:`, this.device.getProperties());
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected handleRawPropertyChange(device: any, type: number, value: string): void {
    this.log.debug(`${this.name} Raw Property Changes: ${type} ${value}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected handlePropertyChange(device: any, name: string, value: PropertyValue): void {
    this.log.debug(`${this.name} Property Changes: ${name} ${value}`);
  }

  /**
   * Register characteristics for a given Homebridge service.
   *
   * This method handles the registration of Homebridge characteristics.
   * It includes optional features like value debouncing and event triggers.
   *
   * @param {Object} params - Parameters needed for registering characteristics.
   */
  protected registerCharacteristic({
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

    // eslint-disable-next-line max-len
    this.log.debug(`${this.name} REGISTER CHARACTERISTIC ${serviceType.name} / ${characteristicType.name}`);

    const service = this.getService(serviceType, name, serviceSubType);
    const characteristic = service.getCharacteristic(characteristicType);

    // eslint-disable-next-line max-len
    this.log.debug(`${this.name} REGISTER CHARACTERISTIC (${service.UUID}) / (${characteristic.UUID})`);

    if (getValue) {
      characteristic.onGet(async (data) => {
        const value = getValue(data, characteristic, service);
        this.log.debug(`${this.name} GET '${serviceType.name} / ${characteristicType.name}': ${value}`);
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
        this.log.info(`${this.name} ON '${serviceType.name} / ${characteristicType.name} / ${onSimpleValue}': ${value}`);
        characteristic.updateValue(value);
      });
    }

    if (onValue) {
      this.log.debug(`${this.name} ON '${serviceType.name} / ${characteristicType.name}'`);
      onValue(service, characteristic);
    }

    if (onMultipleValue) {
      // Attach the common event handler to each event type
      onMultipleValue.forEach(eventType => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.device.on(eventType as keyof any, (device: any, value: any) => {
          // eslint-disable-next-line max-len
          this.log.info(`${this.name} ON '${serviceType.name} / ${characteristicType.name} / ${eventType}': ${value}`);
          characteristic.updateValue(value);
        });
      });
    }

  }

  /**
   * Retrieve an existing service or create a new one if it doesn't exist.
   *
   * @param {ServiceType} serviceType - The type of service to retrieve or create.
   * @param {string} [name] - The name of the service (optional).
   * @param {string} [subType] - The subtype of the service (optional).
   * @returns {Service} Returns the existing or newly created service.
   * @throws Will throw an error if there are overlapping services.
   */
  protected getService(
    serviceType: ServiceType,
    name = this.name,
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
        `Overlapping services for device ${this.name} - ${name} != ${existingService.displayName} - ${serviceType}`,
      );
    }

    if (!this.servicesInUse.includes(service)) {
      this.servicesInUse.push(service);
    }

    return service;
  }

  protected pruneUnusedServices() {
    const safeServiceUUIDs = [
      this.platform.Service.CameraRTPStreamManagement.UUID,
    ];

    this.accessory.services.forEach((service) => {
      if (
        !this.servicesInUse.includes(service) &&
        !safeServiceUUIDs.includes(service.UUID)
      ) {
        // eslint-disable-next-line max-len
        this.log.debug(`${this.name} Pruning unused service ${service.UUID} ${service.displayName || service.name}`);
        this.accessory.removeService(service);
      }
    });
  }

  protected handleDummyEventGet(serviceName: string): Promise<CharacteristicValue> {
    const characteristicValues: Record<string, CharacteristicValue> = {
      'EventSnapshotsActive': this.platform.Characteristic.EventSnapshotsActive.DISABLE,
      'HomeKitCameraActive': this.platform.Characteristic.HomeKitCameraActive.OFF,
    };

    const currentValue = characteristicValues[serviceName];

    if (currentValue === undefined) {
      throw new Error(`Invalid serviceName: ${serviceName}`);
    }

    this.log.debug(`${this.name} IGNORE GET ${serviceName}: ${currentValue}`);
    return Promise.resolve(currentValue);
  }

  protected handleDummyEventSet(serviceName: string, value: CharacteristicValue) {
    this.log.debug(`${this.name} IGNORE SET ${serviceName}: ${value}`);
  }
}