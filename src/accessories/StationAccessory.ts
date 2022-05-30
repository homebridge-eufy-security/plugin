import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Station, DeviceType, PropertyName, PropertyValue, AlarmEvent } from 'eufy-security-client';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class StationAccessory {
  private service: Service;
  private alarm_triggered: boolean;
  private modes;

  protected characteristic;

  private hkStateNames = {
    0: 'Home',
    1: 'Away',
    2: 'Night',
    3: 'Off',
  };

  private guardModeChangeTimeout: NodeJS.Timeout | null = null;
  private retryGuardModeChangeTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly accessory: PlatformAccessory,
    private eufyStation: Station,
  ) {
    this.platform.log.debug(this.accessory.displayName, 'Constructed Station');
    // set accessory information

    this.characteristic = this.platform.Characteristic;

    this.mappingHKEufy();

    this.alarm_triggered = false;

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.characteristic.Manufacturer, 'Eufy')
      .setCharacteristic(
        this.characteristic.Model,
        eufyStation.getModel(),
      )
      .setCharacteristic(
        this.characteristic.SerialNumber,
        eufyStation.getSerial(),
      )
      .setCharacteristic(
        this.characteristic.FirmwareRevision,
        eufyStation.getSoftwareVersion(),
      );

    this.service =
      this.accessory.getService(this.platform.Service.SecuritySystem) ||
      this.accessory.addService(this.platform.Service.SecuritySystem);

    this.service.setCharacteristic(
      this.characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics
    this.service
      .getCharacteristic(this.characteristic.SecuritySystemCurrentState)
      .onGet(this.handleSecuritySystemCurrentStateGet.bind(this));

    this.service
      .getCharacteristic(this.characteristic.SecuritySystemTargetState)
      .onGet(this.handleSecuritySystemTargetStateGet.bind(this))
      .onSet(this.handleSecuritySystemTargetStateSet.bind(this));

    this.eufyStation.on('guard mode', (station: Station, guardMode: number) =>
      this.onStationGuardModePushNotification(station, guardMode),
    );

    this.eufyStation.on('current mode', (station: Station, currentMode: number) =>
      this.onStationCurrentModePushNotification(station, currentMode),
    );

    this.eufyStation.on('alarm event', (station: Station, alarmEvent: AlarmEvent) =>
      this.onStationAlarmEventPushNotification(station, alarmEvent),
    );

    if (this.platform.config.enableDetailedLogging) {
      this.eufyStation.on('raw property changed', (device: Station, type: number, value: string) =>
        this.handleRawPropertyChange(device, type, value),
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
    this.platform.log.debug(this.accessory.displayName, 'ON SecurityGuardMode:', guardMode);
    const homekitCurrentMode = this.convertEufytoHK(guardMode);
    this.service
      .getCharacteristic(this.characteristic.SecuritySystemTargetState)
      .updateValue(homekitCurrentMode);
  }

  private onStationCurrentModePushNotification(
    station: Station,
    currentMode: number,
  ): void {
    if (this.guardModeChangeTimeout) {
      clearTimeout(this.guardModeChangeTimeout);
    }
    if (this.retryGuardModeChangeTimeout) {
      clearTimeout(this.retryGuardModeChangeTimeout);
    }
    this.platform.log.debug(this.accessory.displayName, 'ON SecuritySystemCurrentState:', currentMode);
    const homekitCurrentMode = this.convertEufytoHK(currentMode);
    this.service
      .getCharacteristic(this.characteristic.SecuritySystemCurrentState)
      .updateValue(homekitCurrentMode);
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
        this.platform.log.warn('ON StationAlarmEvent - ALARM TRIGGERED - alarmEvent:', alarmEvent);
        this.alarm_triggered = true;
        this.service
          .getCharacteristic(this.characteristic.SecuritySystemCurrentState)
          .updateValue(this.characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED); // Alarm !!!
        break;
      case 15: // Alarm off by Keypad
      case 16: // Alarm off by Eufy App
      case 17: // Alarm off by HomeBase button
        this.platform.log.warn('ON StationAlarmEvent - ALARM OFF - alarmEvent:', alarmEvent);
        this.alarm_triggered = false;
        break;
      default:
        this.platform.log.warn('ON StationAlarmEvent - ALARM UNKNOWN - alarmEvent:', alarmEvent);
        this.service
          .getCharacteristic(this.characteristic.StatusFault)
          .updateValue(this.characteristic.StatusFault.GENERAL_FAULT);
        break;
    }
  }

  private mappingHKEufy(): void {
    this.modes = [
      { hk: 0, eufy: this.platform.config.hkHome ?? 1 }, // Home
      { hk: 1, eufy: this.platform.config.hkAway ?? 0 }, // Away
      { hk: 2, eufy: this.platform.config.hkNight ?? 3 } // Night
    ];

    // If a keypad attached to the station
    if (this.eufyStation.hasDeviceWithType(DeviceType.KEYPAD)) {
      this.modes.push({ hk: 3, eufy: this.platform.config.hkOff ?? 63 });
      this.modes.push({ hk: 3, eufy: ((this.modes.filter((m) => { return m.eufy === 6; })[0]) ? 63 : 6) });
    } else {
      this.modes.push({ hk: 3, eufy: (this.platform.config.hkOff == 6) ? 63 : this.platform.config.hkOff }); // Enforce 63 if keypad has been selected but not attached to the station
    }
  }

  convertHKtoEufy(hkMode): number {
    const modeObj = this.modes.filter((m) => { return m.hk === hkMode; });
    return parseInt(modeObj[0] ? modeObj[0].eufy : hkMode);
  }

  convertEufytoHK(eufyMode): number {
    const modeObj = this.modes.filter((m) => { return m.eufy === eufyMode; });
    return parseInt(modeObj[0] ? modeObj[0].hk : eufyMode);
  }

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleSecuritySystemCurrentStateGet(): Promise<CharacteristicValue> {
    if (this.alarm_triggered) {
      return this.characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
    }
    try {
      const currentValue = this.eufyStation.getPropertyValue(PropertyName.StationCurrentMode);
      if (currentValue === -1) throw 'Something wrong with this device';
      this.platform.log.debug(this.accessory.displayName, 'GET StationCurrentMode:', currentValue);
      return this.convertEufytoHK(currentValue);
    } catch {
      this.platform.log.error(this.accessory.displayName, 'handleSecuritySystemCurrentStateGet', 'Wrong return value');
      return false;
    }
  }

  /**
   * Handle requests to get the current value of the 'Security System Target State' characteristic
   */
  handleSecuritySystemTargetStateGet(): CharacteristicValue {
    try {
      const currentValue = this.eufyStation.getPropertyValue(PropertyName.StationCurrentMode);
      if (currentValue === -1) throw 'Something wrong with this device';
      this.platform.log.debug(this.accessory.displayName, 'GET StationCurrentMode:', currentValue);
      return this.convertEufytoHK(currentValue);
    } catch {
      this.platform.log.error(this.accessory.displayName, 'handleSecuritySystemTargetStateGet', 'Wrong return value');
      return false;
    }
  }

  /**
   * Handle requests to set the 'Security System Target State' characteristic
   */
  private handleSecuritySystemTargetStateSet(value: CharacteristicValue) {
    try {
      this.alarm_triggered = false;
      const mode = this.convertHKtoEufy(value);
      this.platform.log.debug(this.accessory.displayName, 'SET StationGuardMode:' + mode);
      this.platform.log.info(this.accessory.displayName, 'Request to change station guard mode to: ' +
                                this.hkStateNames[value as number] + '.');
      this.eufyStation.setGuardMode(mode);

      this.guardModeChangeTimeout = setTimeout(() => {
        this.platform.log.warn('Changing guard mode to ' + this.hkStateNames[value as number] + 'did not complete. Retry...');
        this.eufyStation.setGuardMode(mode);

        this.retryGuardModeChangeTimeout = setTimeout(() => {
          this.platform.log.error('Changing guard mode to ' + this.hkStateNames[value as number] + ' timed out!');
        }, 5000);
      }, 5000);
    } catch (error) {
      this.platform.log.error('Error Setting security mode!', error);
    }
  }

  private handleRawPropertyChange(
    device: Station,
    type: number,
    value: string,
  ): void {
    this.platform.log.debug(this.accessory.displayName,
      'ON handleRawPropertyChange:',
      {
        type,
        value,
      },
    );
  }

  private handlePropertyChange(
    device: Station,
    name: string,
    value: PropertyValue,
  ): void {
    this.platform.log.debug(this.accessory.displayName,
      'ON handlePropertyChange:',
      {
        name,
        value,
      },
    );
  }
}
