import { Service, PlatformAccessory, PlatformConfig } from 'homebridge';

import { EufySecurityPlatformConfig } from './config';

import { EufySecurityPlatform } from './platform';
import { Station, PropertyValue } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SecuritySystemPlatformAccessory {
  private service: Service;
  private alarm_triggered: boolean;
  private guardMode: number;

  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly accessory: PlatformAccessory,
    private eufyStation: Station,
    private config: EufySecurityPlatformConfig,
  ) {
    this.platform.log.debug(this.accessory.displayName, 'Constructed SecuritySystem');
    // set accessory information

    this.alarm_triggered = false;
    this.guardMode = 0;

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Eufy')
      .setCharacteristic(
        this.platform.Characteristic.Model,
        eufyStation.getModel(),
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        eufyStation.getSerial(),
      )
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        eufyStation.getSoftwareVersion(),
      );

    this.service =
      this.accessory.getService(this.platform.Service.SecuritySystem) ||
      this.accessory.addService(this.platform.Service.SecuritySystem);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      .on('get', this.handleSecuritySystemCurrentStateGet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .on('get', this.handleSecuritySystemTargetStateGet.bind(this))
      .on('set', this.handleSecuritySystemTargetStateSet.bind(this));

    this.eufyStation.on(
      'guard mode',
      (station: Station, guardMode: number, currentMode: number) =>
        this.onStationGuardModePushNotification(
          station,
          guardMode,
          currentMode,
        ),
    );

    this.eufyStation.on(
      'alarm mode',
      (station: Station, alarm_type: number) =>
        this.onStationAlarmTriggeredPushNotification(
          station,
          alarm_type,
        ),
    );

    if(this.config.enableDetailedLogging) {
      this.eufyStation.on('raw property changed', (device: Station, type: number, value: string, modified: number) =>
        this.handleRawPropertyChange(device, type, value, modified),
      );
      this.eufyStation.on('property changed', (device: Station, name: string, value: PropertyValue) =>
        this.handlePropertyChange(device, name, value),
      );
    }
  }

  private onStationGuardModePushNotification(
    station: Station,
    guardMode: number,
    currentMode: number,
  ): void {
    const homekitGuardMode = this.convertStatusCodeToHomekit(guardMode);
    if (homekitGuardMode) {
      this.platform.log.debug(
        'Received StationGuardModePushNotification - guardmode ' +
          guardMode +
          ' homekitGuardMode ' +
          homekitGuardMode,
      );
      this.service
        .getCharacteristic(
          this.platform.Characteristic.SecuritySystemCurrentState,
        )
        .updateValue(homekitGuardMode);

      this.service
        .getCharacteristic(
          this.platform.Characteristic.SecuritySystemTargetState,
        )
        .updateValue(homekitGuardMode);
    }
  }
  
  private onStationAlarmTriggeredPushNotification(
    station: Station,
    alarm_type: number,
  ): void {
    switch (alarm_type) {
      // case 3: // Alarm triggered by camera
      // case 6: // Alarm triggered by contact sensor
      // case 8: // Alarm triggered by motion sensor
      //   this.platform.log.warn('Received StationAlarmTriggeredPushNotification - ALARM TRIGGERED - alarm_type: ' + alarm_type);
      //   this.alarm_triggered = true;
      //   this.service
      //     .getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      //     .updateValue(4); // Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
      //   break;
      // case 15: // Alarm off by Keypad
      // case 16: // Alarm off by Eufy App
      // case 17: // Alarm off by HomeBase button
      //   this.platform.log.warn('Received StationAlarmTriggeredPushNotification - ALARM OFF - alarm_type: ' + alarm_type);
      //   this.alarm_triggered = false;
      //   this.service
      //     .getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      //     .updateValue(this.guardMode); // Back to normal
      //   break;
      default:
        this.platform.log.warn('Received StationAlarmTriggeredPushNotification - ALARM UNKNOWN - alarm_type: ' + alarm_type);
        this.service
          .getCharacteristic(this.platform.Characteristic.StatusFault)
          .updateValue(this.platform.Characteristic.StatusFault.GENERAL_FAULT);
        break;
    }
  }

  async getCurrentStatus() {
    this.platform.log.debug(
      this.eufyStation.isConnected()
        ? 'Connected to Eufy API'
        : 'Not connected to Eufy API',
    );

    const guardMode = this.eufyStation.getGuardMode();

    this.platform.log.info('Eufy Guard Mode: ', guardMode);

    this.guardMode = (this.alarm_triggered) ? 4 : guardMode.value as number;

    return this.convertStatusCodeToHomekit(this.guardMode as number);
  }

  convertMode(eufyMode: number) {
    const modes = [
      { hk: 0, eufy: this.config.hkHome ?? 1 },
      { hk: 1, eufy: this.config.hkAway ?? 0 },
      { hk: 2, eufy: this.config.hkNight ?? 3 },
      { hk: 3, eufy: this.config.hkOff ?? 63 },
      { hk: 3, eufy: this.config.hkDisarmed ?? 6 },
    ];
    const modeObj = modes.filter((m) => {
      return m.eufy === eufyMode;
    });

    return modeObj[0] ? modeObj[0].hk : eufyMode;
  }

  convertStatusCodeToHomekit(code: number) {
    //---Eufy Modes--------
    //     0: 'AWAY',
    //     1: 'HOME',
    //     2: 'SCHEDULE',
    //     3: 'CUSTOM1',
    //     4: 'CUSTOM2',
    //     5: 'CUSTOM3',
    //     47: 'GEO',
    //     63: 'DISARMED'
    //-----------------------
    //---HomeKit Modes-------
    //     0: 'STAY_ARM',
    //     1: 'AWAY_ARM',
    //     2: 'NIGHT_ARM',
    //     3: 'DISARMED',
    //     4: 'ALARM_TRIGGERED',
    //-----------------------
    switch (code) {
      case 0: //Eufy mode
        return this.convertMode(0);
      case 1:
        return this.convertMode(1);
      case 2:
        return this.convertMode(2);
      case 3:
        return this.convertMode(3);
      case 4:
        return this.convertMode(4);
      case 5:
        return this.convertMode(5);
      case 6: // 6 is triggered  when disabled  by Keypad
        return this.convertMode(6);
      case 47:
        return this.convertMode(47);
      case 63:
        return this.convertMode(63);
      default:
        break;
    }
  }

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleSecuritySystemCurrentStateGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET SecuritySystemCurrentState');

    // set this to a valid value for SecuritySystemCurrentState
    const currentValue = await this.getCurrentStatus();

    this.platform.log.debug(this.accessory.displayName, 'Handle Current System state:  -- ', currentValue);

    callback(null, (this.alarm_triggered) ? 4 : currentValue);
  }

  /**
   * Handle requests to get the current value of the 'Security System Target State' characteristic
   */
  async handleSecuritySystemTargetStateGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET SecuritySystemTargetState');

    // set this to a valid value for SecuritySystemTargetState
    const currentValue = await this.getCurrentStatus();

    callback(null, currentValue);
  }

  private handleRawPropertyChange(
    device: Station, 
    type: number, 
    value: string, 
    modified: number,
  ): void {
    this.platform.log.info(
      'Handle Station Raw Property Changes:  -- ',
      type, 
      value, 
      modified,
    );
  }

  private handlePropertyChange(
    device: Station, 
    name: string, 
    value: PropertyValue,
  ): void {
    this.platform.log.info(
      'Handle Station Property Changes:  -- ',
      name, 
      value,
    );
  }

  /**
   * Handle requests to set the 'Security System Target State' characteristic
   */
  handleSecuritySystemTargetStateSet(value, callback) {
    //   states: {
    //     0: 'AWAY',
    //     1: 'HOME',
    //     2: 'SCHEDULE',
    //     3: 'CUSTOM1',
    //     4: 'CUSTOM2',
    //     5: 'CUSTOM3',
    //     47: 'GEO',
    //     63: 'DISARMED'
    // }

    let mode = -1;
    switch (value) {
      case 0: //homekit HOME
        mode = this.config.hkHome ?? 1; //eufy home
        break;
      case 1: //homekit AWAY
        mode = this.config.hkAway ?? 0;
        break;
      case 2: //homekit NIGHT
        mode = this.config.hkNight ?? 3;
        break;
      case 3: //homekit OFF
        mode = this.config.hkOff ?? 63;
        break;
      default:
        break;
    }

    if (mode === -1) {
      this.platform.log.error(
        'Error Setting security mode! (mode returned -1)',
      );
    } else {
      try {
        this.eufyStation.setGuardMode(mode);
        this.service.updateCharacteristic(
          this.platform.Characteristic.SecuritySystemCurrentState,
          value,
        );
      } catch (error) {
        this.platform.log.error('Error Setting security mode!', error);
      }
    }
    callback(null);
  }
}
