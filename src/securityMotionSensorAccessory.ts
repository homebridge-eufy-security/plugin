import {
  Service,
  PlatformAccessory,
} from "homebridge";


import { EufySecurityPlatform } from './platform';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

import { MotionSensor } from "eufy-security-client";

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SecurityMotionSensorAccessory {
  private service: Service;

  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly accessory: PlatformAccessory,
    private eufyDevice: MotionSensor
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
        eufyDevice.getSerial()
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
