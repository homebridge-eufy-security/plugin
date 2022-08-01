import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Station, DeviceType, PropertyName, PropertyValue, AlarmEvent } from 'eufy-security-client';
import { StationConfig } from '../utils/configTypes';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class StationAccessory {

  private station: Station;

  private service: Service;
  private manualTriggerService: Service;
  private alarm_triggered: boolean;
  private modes;

  private alarm_delayed: boolean;
  private alarm_delay_timeout?: NodeJS.Timeout;
  
  protected characteristic;

  public readonly stationConfig: StationConfig;

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

    this.station = eufyStation;
    this.characteristic = this.platform.Characteristic;

    this.stationConfig = this.getStationConfig();

    this.mappingHKEufy();

    this.alarm_triggered = false;
    this.alarm_delayed = false;

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

    this.manualTriggerService = 
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);
    
    this.manualTriggerService.setCharacteristic(
      this.characteristic.Name,
      accessory.displayName + ' alarm switch',
    );

    this.manualTriggerService
      .getCharacteristic(this.characteristic.On)
      .onGet(this.handleManualTriggerSwitchStateGet.bind(this))
      .onSet(this.handleManualTriggerSwitchStateSet.bind(this));

    this.eufyStation.on('guard mode', (station: Station, guardMode: number) =>
      this.onStationGuardModePushNotification(station, guardMode),
    );

    this.eufyStation.on('current mode', (station: Station, currentMode: number) =>
      this.onStationCurrentModePushNotification(station, currentMode),
    );

    this.eufyStation.on('alarm event', (station: Station, alarmEvent: AlarmEvent) =>
      this.onStationAlarmEventPushNotification(station, alarmEvent),
    );

    this.eufyStation.on('alarm arm delay event', this.onStationAlarmDelayedEvent.bind(this));
    this.eufyStation.on('alarm armed event', this.onStationAlarmArmedEvent.bind(this));

    if (this.platform.config.enableDetailedLogging) {
      this.eufyStation.on('raw property changed', (device: Station, type: number, value: string) =>
        this.handleRawPropertyChange(device, type, value),
      );
      this.eufyStation.on('property changed', (device: Station, name: string, value: PropertyValue) =>
        this.handlePropertyChange(device, name, value),
      );
    }
  }

  private getStationConfig() {

    let config = {} as StationConfig;

    if (typeof this.platform.config.stations !== 'undefined') {
      // eslint-disable-next-line prefer-arrow-callback, brace-style
      const pos = this.platform.config.stations.map(function (e) { return e.serialNumber; }).indexOf(this.station.getSerial());
      config = { ...this.platform.config.stations[pos] };
    }

    if (config.hkHome || this.platform.config.hkHome) {
      config.hkHome = config.hkHome ??= this.platform.config.hkHome;
    }
    if (config.hkAway || this.platform.config.hkAway) {
      config.hkAway = config.hkAway ??= this.platform.config.hkAway;
    }
    if (config.hkNight || this.platform.config.hkNight) {
      config.hkNight = config.hkNight ??= this.platform.config.hkNight;
    }
    if (config.hkOff || this.platform.config.hkOff) {
      config.hkOff = config.hkOff ??= this.platform.config.hkOff;
    }

    if (!Array.isArray(config.manualTriggerModes)) {
      config.manualTriggerModes = [];
    }
    this.platform.log.debug(
      this.accessory.displayName, 'manual alarm will be triggered only in these hk modes: ' + config.manualTriggerModes);

    config.manualAlarmSeconds = config.manualAlarmSeconds ??= 30;

    return config;
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
    let currentValue = this.eufyStation.getPropertyValue(PropertyName.StationCurrentMode);
    if (alarmEvent === 0) {
      // do not resset alarm if alarm was triggered manually
      // since the alarm can only be triggered for 30 seconds for now (limitation of eufy-security-client)
      // this would mean that the alarm is always reset after 30 seconds
      // see here: https://github.com/bropat/eufy-security-client/issues/178
      currentValue = -1;
    }
    switch (alarmEvent) {
      case 2: // Alarm triggered by GSENSOR
      case 3: // Alarm triggered by PIR
      case 4: // Alarm triggered by EUFY_APP
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
      case 0:  // Alarm off by Hub
      case 15: // Alarm off by Keypad
      case 16: // Alarm off by Eufy App
      case 17: // Alarm off by HomeBase button
        this.platform.log.warn('ON StationAlarmEvent - ALARM OFF - alarmEvent:', alarmEvent);
        this.alarm_triggered = false;
        if (currentValue !== -1) {
          this.service
            .getCharacteristic(this.characteristic.SecuritySystemCurrentState)
            .updateValue(this.convertEufytoHK(currentValue)); // reset alarm state
        }
        break;
      default:
        this.platform.log.warn('ON StationAlarmEvent - ALARM UNKNOWN - alarmEvent:', alarmEvent);
        this.service
          .getCharacteristic(this.characteristic.StatusFault)
          .updateValue(this.characteristic.StatusFault.GENERAL_FAULT);
        break;
    }
    this.manualTriggerService
      .getCharacteristic(this.characteristic.On)
      .updateValue(this.alarm_triggered);
  }

  private mappingHKEufy(): void {
    this.modes = [
      { hk: 0, eufy: this.stationConfig.hkHome ?? 1 }, // Home
      { hk: 1, eufy: this.stationConfig.hkAway ?? 0 }, // Away
      { hk: 2, eufy: this.stationConfig.hkNight ?? 3 }, // Night
    ];

    // If a keypad attached to the station
    if (this.eufyStation.hasDeviceWithType(DeviceType.KEYPAD)) {
      this.modes.push({ hk: 3, eufy: this.stationConfig.hkOff ?? 63 });
      this.modes.push({ hk: 3, eufy: ((this.modes.filter((m) => {
        return m.eufy === 6;
      })[0]) ? 63 : 6) });
    } else if (this.stationConfig.hkOff !== undefined && this.stationConfig.hkOff !== null) {
      this.modes.push({
        hk: 3,
        eufy: (this.stationConfig.hkOff === 6) ? 63 : this.stationConfig.hkOff,
      }); // Enforce 63 if keypad has been selected but not attached to the station
    } else {
      this.modes.push({
        hk: 3,
        eufy:  63,
      }); // Enforce 63 if hkOff is not set
    }

    this.platform.log.debug(this.accessory.displayName, 'Mapping for station modes: ' + JSON.stringify(this.modes));
  }

  convertHKtoEufy(hkMode): number {
    const modeObj = this.modes.filter((m) => {
      return m.hk === hkMode;
    });
    return parseInt(modeObj[0] ? modeObj[0].eufy : hkMode);
  }

  convertEufytoHK(eufyMode): number {
    const modeObj = this.modes.filter((m) => {
      return m.eufy === eufyMode;
    });
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
      if (currentValue === -1) {
        throw 'Something wrong with this device';
      }
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
  private handleSecuritySystemTargetStateGet(): CharacteristicValue {
    try {
      const currentValue = this.eufyStation.getPropertyValue(PropertyName.StationCurrentMode);
      if (currentValue === -1) {
        throw 'Something wrong with this device';
      }
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
      this.platform.log.debug(this.accessory.displayName, 'SET StationGuardMode (raw value homekit):' + value);
      const mode = this.convertHKtoEufy(value);
      if (isNaN(mode)) {
        throw new Error(this.accessory.displayName + ': Could not convert guard mode value to valid number. Aborting guard mode change...');
      }
      this.platform.log.debug(this.accessory.displayName, 'SET StationGuardMode:' + mode);
      this.platform.log.info(this.accessory.displayName, 'Request to change station guard mode to: ' + this.getGuardModeName(value) + '.');
      this.eufyStation.setGuardMode(mode);

      this.guardModeChangeTimeout = setTimeout(() => {
        this.platform.log.warn(
          this.accessory.displayName,
          'Changing guard mode to ' + this.getGuardModeName(value) + 'did not complete. Retry...');
        this.eufyStation.setGuardMode(mode);

        this.retryGuardModeChangeTimeout = setTimeout(() => {
          this.platform.log.error(this.accessory.displayName, 'Changing guard mode to ' + this.getGuardModeName(value) + ' timed out!');
        }, 5000);
      }, 5000);

      this.manualTriggerService
        .getCharacteristic(this.characteristic.On)
        .updateValue(false);
    } catch (error) {
      this.platform.log.error(this.accessory.displayName + ': Error Setting security mode!', error);
    }
  }

  private handleManualTriggerSwitchStateGet(): CharacteristicValue {
    return this.alarm_triggered;
  }

  private async handleManualTriggerSwitchStateSet(value: CharacteristicValue) {
    if (value) { // trigger alarm
      try {
        const currentValue = this.eufyStation.getPropertyValue(PropertyName.StationCurrentMode);
        if (currentValue === -1) {
          throw 'Something wrong with this device';
        }
        // check if alarm is allowed for this guard mode
        // and alarm is not delayed
        if (this.stationConfig.manualTriggerModes.indexOf(this.convertEufytoHK(currentValue)) !== -1 && !this.alarm_delayed) {
          this.eufyStation.triggerStationAlarmSound(this.stationConfig.manualAlarmSeconds)
            .then(() => this.platform.log.debug(
              this.accessory.displayName, 'alarm manually triggered for ' + this.stationConfig.manualAlarmSeconds + ' seconds.'))
            .catch(err => this.platform.log.error(this.accessory.displayName, 'alarm could not be manually triggered: ' + err));
        } else {
          const message = this.alarm_delayed ?
            'tried to trigger alarm, but the alarm delayed event was triggered beforehand.' :
            'tried to trigger alarm, but the current station mode prevents the alarm from being triggered. ' +
            'Please look in in the configuration if you want to change this behaviour.';
          setTimeout(() => {
            this.platform.log.info(this.accessory.displayName, message);
            this.manualTriggerService
              .getCharacteristic(this.characteristic.On)
              .updateValue(false);
          }, 1000);
        }
      } catch {
        this.platform.log.error(this.accessory.displayName, 'handleSecuritySystemTargetStateGet', 'Wrong return value');
        return;
      }
    } else { // reset alarm
      this.eufyStation.resetStationAlarmSound()
        .then(() => this.platform.log.debug(this.accessory.displayName, 'alarm manually reset'))
        .catch(err => this.platform.log.error(this.accessory.displayName, 'alarm could not be reset: ' + err));
    }
  }

  private onStationAlarmDelayedEvent(station: Station, armDelay: number) {
    this.platform.log.debug(this.accessory.displayName, `alarm for this station will be delayed by ${armDelay} seconds.`);
    this.alarm_delayed = true;

    if (this.alarm_delay_timeout) {
      clearTimeout(this.alarm_delay_timeout);
    }

    this.alarm_delay_timeout = setTimeout(() => {
      this.platform.log.debug(this.accessory.displayName, 'alarm for this station is armed now (due to timeout).');
      this.alarm_delayed = false;
    }, (armDelay + 1) * 1000);
  }

  private onStationAlarmArmedEvent(station: Station) {
    this.platform.log.debug(this.accessory.displayName, 'alarm for this station is armed now.');
    this.alarm_delayed = false;

    if (this.alarm_delay_timeout) {
      clearTimeout(this.alarm_delay_timeout);
    }
  }

  private getGuardModeName(value: CharacteristicValue): string {
    try {
      return this.hkStateNames[value as number];
    } catch (error) {
      return 'Unknown';
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
