import {
  Service,
  PlatformAccessory,
} from "homebridge";

import { EufySecurityPlatform } from "./platform";

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

import { Station } from "eufy-security-client";

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SecuritySystemPlatformAccessory {
  private service: Service;

  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly accessory: PlatformAccessory,
    private eufyStation: Station
  ) {
    this.platform.log.debug("Constructed Switch");
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, "Eufy")
      .setCharacteristic(
        this.platform.Characteristic.Model,
        "Security Mode Control"
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        eufyStation.getSerial()
      );

    this.service =
      this.accessory.getService(this.platform.Service.SecuritySystem) ||
      this.accessory.addService(this.platform.Service.SecuritySystem);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName
    );

    // create handlers for required characteristics
    this.service
      .getCharacteristic(
        this.platform.Characteristic.SecuritySystemCurrentState
      )
      .on("get", this.handleSecuritySystemCurrentStateGet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .on("get", this.handleSecuritySystemTargetStateGet.bind(this))
      .on("set", this.handleSecuritySystemTargetStateSet.bind(this));
  }

  async getCurrentStatus() {
    this.platform.log.debug(
      this.eufyStation.isConnected()
        ? "Connected to Eufy API"
        : "Not connected to Eufy API"
    );

    // const arm_mode_obj = hubs[0].params.filter(param => param.param_type === 1224);
    // this.platform.log.debug('getCurrentStatus() -- ', arm_mode_obj);
    // this.platform.log.debug('getCurrentStatus() RETURN -- ', arm_mode_obj[0].param_value);
    const guardMode = this.eufyStation.getGuardMode();

    this.platform.log.debug("Eufy Guard Mode: ", guardMode);

    return this.convertStatusCodeToHomekit(guardMode.value as number);
  }

  convertStatusCodeToHomekit(code: number) {
    switch (code) {
      case 1: //Eufy HOME
        return 0; //homekit home
      case 0: //Eufy AWAY
        return 1; //homekit away
      case 2: //Eufy NIGHT
        return 2; //homekit night (for now)
      case 47: //Eufy GEO
        return 4; //homekit alarm
      case 63: //Eufy Disarmed
        return 3; //homekit disarmed (off)

      default:
        break;
    }
  }

  /**
   * Handle requests to get the current value of the "Security System Current State" characteristic
   */
  async handleSecuritySystemCurrentStateGet(callback) {
    this.platform.log.debug("Triggered GET SecuritySystemCurrentState");

    // set this to a valid value for SecuritySystemCurrentState
    const currentValue = await this.getCurrentStatus();
    this.platform.log.debug("Handle Current System state:  -- ", currentValue);

    callback(null, currentValue);
  }

  /**
   * Handle requests to get the current value of the "Security System Target State" characteristic
   */
  async handleSecuritySystemTargetStateGet(callback) {
    this.platform.log.debug("Triggered GET SecuritySystemTargetState");

    // set this to a valid value for SecuritySystemTargetState
    const currentValue = await this.getCurrentStatus();

    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "Security System Target State" characteristic
   */
  handleSecuritySystemTargetStateSet(value, callback) {
    // this.platform.log.debug('IsConnected? ', this.devClientService.isConnected());
    // this.platform.log.debug('devClientService ', this.devClientService);
    // this.platform.log.debug('Triggered SET SecuritySystemTargetState:', value);
    // if (!this.devClientService.isConnected()) {

    // }

    // CMD_SET_ARMING  # 0 => away 1 => home, 2 => schedule, 63 => disarmed
    //   states: {
    //     0: "AWAY",
    //     1: "HOME",
    //     2: "SCHEDULE",
    //     3: "NIGHT",
    //     4: "CUSTOM2",
    //     5: "CUSTOM3",
    //     47: "GEO",
    //     63: "DISARMED"
    // }

    let mode = -1;
    switch (value) {
      case 0: //homekit HOME
        mode = 1; //eufy home
        break;
      case 1: //homekit AWAY
        mode = 0; //eufy away
        break;
      case 2: //homekit NIGHT
        mode = 3; //eufy NIGHT
        break;
      case 3: //homekit OFF
        mode = 63; //Eufy disarmed
        break;
      default:
        break;
    }

    if (mode === -1) {
      this.platform.log.error("Error Setting security mode!");
    } else {
      try {
        this.eufyStation.setGuardMode(mode);
        this.service.updateCharacteristic(
          this.platform.Characteristic.SecuritySystemCurrentState,
          value
        );
      } catch (error) {
        this.platform.log.error(
          "Error Setting security mode! (Line 141",
          error
        );
      }
    }
    callback(null);
  }
}
