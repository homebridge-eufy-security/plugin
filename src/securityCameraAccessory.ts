import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
} from 'homebridge';

import { EufySecurityPlatform } from './platform';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

import { EufySecurity, HTTPApi, Station, Device, Sensor, Camera } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SecurityCameraAccessory {
  private service: Service;

  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly accessory: PlatformAccessory,
    private eufyClient: EufySecurity,
    private eufyDevice: Camera,
  ) {
    this.platform.log.debug('Constructed Switch');
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Eufy')
      .setCharacteristic(
        this.platform.Characteristic.Model,
        'Security Mode Control',
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        accessory.UUID,
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
      .getCharacteristic(
        this.platform.Characteristic.MotionDetected,
      )
      .on('get', this.handleSecuritySystemCurrentStateGet.bind(this));

  }

  async getCurrentStatus() {
    this.platform.log.debug(
      this.eufyClient.isConnected()
        ? 'Connected to Eufy API'
        : 'Not connected to Eufy API',
    );

    // const arm_mode_obj = hubs[0].params.filter(param => param.param_type === 1224);
    // this.platform.log.debug('getCurrentStatus() -- ', arm_mode_obj);
    // this.platform.log.debug('getCurrentStatus() RETURN -- ', arm_mode_obj[0].param_value);

    const isMotionDetected = this.eufyDevice.isMotionDetected();

    return isMotionDetected as boolean;
  }

  /**
   * Handle requests to get the current value of the "Security System Current State" characteristic
   */
  async handleSecuritySystemCurrentStateGet(callback) {
    this.platform.log.debug('Triggered GET SecuritySystemCurrentState');

    // set this to a valid value for SecuritySystemCurrentState
    const currentValue = await this.getCurrentStatus();
    this.platform.log.debug('Handle Current System state:  -- ', currentValue);

    callback(null, currentValue);
  }

}
