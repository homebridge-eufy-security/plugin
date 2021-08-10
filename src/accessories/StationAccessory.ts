import { Service, PlatformAccessory, PlatformConfig } from 'homebridge';

import { EufySecurityPlatformConfig } from '../config';

import { EufySecurityPlatform } from '../platform';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Station, PropertyValue, AlarmEvent } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class StationAccessory {
  private service: Service;
  private alarm_triggered: boolean;
  private guardMode: number;

  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly accessory: PlatformAccessory,
    private eufyStation: Station,
  ) {
    this.platform.log.debug(this.accessory.displayName, 'Constructed Station');
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
      (station: Station, guardMode: number) =>
        this.onStationGuardModePushNotification(
          station,
          guardMode,
        ),
    );

    this.eufyStation.on(
      'current mode',
      (station: Station, currentMode: number) =>
        this.onStationCurrentModePushNotification(
          station,
          currentMode,
        ),
    );

    this.eufyStation.on(
      'alarm event',
      (station: Station, alarmEvent: AlarmEvent) =>
        this.onStationAlarmEventPushNotification(
          station,
          alarmEvent,
        ),
    );

    if (this.platform.config.enableDetailedLogging) {
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
  ): void {
    const homekitGuardMode = this.convertEufytoHK(guardMode);
    if (homekitGuardMode) {
      this.platform.log.debug(
        'Received onStationGuardModePushNotification - guardmode ' +
        guardMode +
        ' homekitGuardMode ' +
        homekitGuardMode,
      );

      this.service
        .getCharacteristic(
          this.platform.Characteristic.SecuritySystemTargetState,
        )
        .updateValue(homekitGuardMode);
    }
  }

  private onStationCurrentModePushNotification(
    station: Station,
    currentMode: number,
  ): void {
    const homekitCurrentMode = this.convertEufytoHK(currentMode);
    if (homekitCurrentMode) {
      this.platform.log.debug(
        'Received onStationCurrentModePushNotification - currentMode ' +
        currentMode +
        ' homekitCurrentMode ' +
        homekitCurrentMode,
      );

      this.service
        .getCharacteristic(
          this.platform.Characteristic.SecuritySystemCurrentState,
        )
        .updateValue(homekitCurrentMode);
    }
  }

  private onStationAlarmEventPushNotification(
    station: Station,
    alarmEvent: AlarmEvent,
  ): void {
    switch (alarmEvent) {
      case 2: // Alarm triggered by GSENSOR
      case 3: // Alarm triggered by PIR
      case 6: // Alarm triggered by DOOR
      case 7: // Alarm triggered by CAMERA_PIR
      case 8: // Alarm triggered by MOTION_SENSOR
      case 9: // Alarm triggered by CAMERA_GSENSOR
        this.platform.log.warn('Received onStationAlarmEventPushNotification - ALARM TRIGGERED - alarmEvent: ' + alarmEvent);
        this.alarm_triggered = true;
        this.service
          .getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
          .updateValue(4); // Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
        break;
      case 15: // Alarm off by Keypad
      case 16: // Alarm off by Eufy App
      case 17: // Alarm off by HomeBase button
        this.platform.log.warn('Received onStationAlarmEventPushNotification - ALARM OFF - alarmEvent: ' + alarmEvent);
        this.alarm_triggered = false;
        this.service
          .getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
          .updateValue(this.guardMode); // Back to normal
        break;
      default:
        this.platform.log.warn('Received onStationAlarmEventPushNotification - ALARM UNKNOWN - alarmEvent: ' + alarmEvent);
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
    this.platform.log.debug('Eufy Guard Mode: ', guardMode);
    this.guardMode = (this.alarm_triggered) ? 4 : guardMode.value as number;

    return this.convertEufytoHK(this.guardMode as number);
  }

  async getTargetStatus() {
    this.platform.log.debug(
      this.eufyStation.isConnected()
        ? 'Connected to Eufy API'
        : 'Not connected to Eufy API',
    );

    const guardMode = this.eufyStation.getGuardMode();
    this.platform.log.debug('Eufy Guard Mode: ', guardMode);

    return this.convertEufytoHK(this.guardMode as number);
  }

  mappingHKEufy() {
    const modes = [
      { hk: 0, eufy: this.platform.config.hkHome ?? 1 },
      { hk: 1, eufy: this.platform.config.hkAway ?? 0 },
      { hk: 2, eufy: this.platform.config.hkNight ?? 3 },
      { hk: 3, eufy: this.platform.config.hkOff ?? 63 },
    ];

    //modes.push({ hk: 3, eufy: ((modes.filter((m) => { return m.eufy === 6; })[0]) ? 63 : 6) });

    return modes;
  }

  convertHKtoEufy(hkMode: number) {
    const modeObj = this.mappingHKEufy().filter((m) => { return m.hk === hkMode; });
    return modeObj[0] ? modeObj[0].eufy : hkMode;
  }

  convertEufytoHK(eufyMode: number) {
    const modeObj = this.mappingHKEufy().filter((m) => { return m.eufy === eufyMode; });
    return modeObj[0] ? modeObj[0].hk : eufyMode;
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
    const currentValue = await this.getTargetStatus();

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

    const mode = this.convertHKtoEufy(value);

    try {
      this.guardMode = mode;
      this.eufyStation.setGuardMode(mode);
      this.service.updateCharacteristic(
        this.platform.Characteristic.SecuritySystemCurrentState,
        value,
      );
    } catch (error) {
      this.platform.log.error('Error Setting security mode!', error);
    }

    callback(null);
  }
}
