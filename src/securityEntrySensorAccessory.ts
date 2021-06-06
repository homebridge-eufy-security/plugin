import { Service, PlatformAccessory } from 'homebridge';

import { EufySecurityPlatform } from './platform';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

import { Device, EntrySensor, EufySecurity } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SecurityEntrySensorAccessory {
  private service: Service;

  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly accessory: PlatformAccessory,
    private eufyDevice: EntrySensor,
    private client: EufySecurity,
  ) {
    this.platform.log.debug('Constructed Entry Sensor');
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Eufy')
      .setCharacteristic(
        this.platform.Characteristic.Model,
        eufyDevice.getModel(),
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        eufyDevice.getSerial(),
      );

    this.service =
      this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .on('get', this.handleSecuritySystemCurrentStateGet.bind(this));

    this.eufyDevice.on('open', (device: Device, state: boolean) =>
      this.onDeviceOpenPushNotification(device, state),
    );
  }

  private onDeviceOpenPushNotification(device: Device, state: boolean): void {
    this.service
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .updateValue(state);
  }

  async getCurrentStatus() {
    await this.platform.refreshData(this.client);
    const isSensorOpen = this.eufyDevice.isSensorOpen();
    return isSensorOpen.value;
  }

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleSecuritySystemCurrentStateGet(callback) {
    this.platform.log.debug('Triggered GET SecuritySystemCurrentState');

    // set this to a valid value for SecuritySystemCurrentState
    const currentValue = await this.getCurrentStatus();
    this.platform.log.debug('Handle Current System state:  -- ', currentValue);

    callback(null, currentValue);
  }
}
