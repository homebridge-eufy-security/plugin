import { Service, PlatformAccessory, Characteristic, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Camera, Device, DeviceEvents, PropertyName, CommandName } from 'eufy-security-client';
import { StreamingDelegate } from '../controller/streamingDelegate';

import { CameraConfig, VideoConfig } from '../utils/configTypes';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class CameraAccessory extends DeviceAccessory {

  // Define the object variable to hold the boolean and timestamp
  protected cameraStatus: { isEnabled: boolean; timestamp: number };
  private ring_triggered: boolean = false;

  public readonly cameraConfig: CameraConfig;

  protected streamingDelegate: StreamingDelegate | null = null;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: Camera,
  ) {
    super(platform, accessory, device);
    this.cameraConfig = {} as CameraConfig;

    this.cameraStatus = { isEnabled: false, timestamp: 0 }; // Initialize the cameraStatus object

    this.platform.log.debug(this.accessory.displayName, 'Constructed Camera');

    this.cameraConfig = this.getCameraConfig();
    // this.platform.log.debug(this.accessory.displayName, 'config is:', this.cameraConfig);

    if (this.cameraConfig.enableCamera || (typeof this.device.isDoorbell === 'function' && this.device.isDoorbell())) {
      this.platform.log.debug(this.accessory.displayName, 'has a camera');

      try {
        this.cameraFunction();
        const delegate = new StreamingDelegate(this.platform, device, this.cameraConfig, this.platform.api, this.platform.api.hap);
        this.streamingDelegate = delegate;
        accessory.configureController(delegate.controller);
      } catch (error) {
        this.platform.log.error(this.accessory.displayName, 'raise error to check and attach livestream function.', error);
      }

    } else {
      this.platform.log.debug(this.accessory.displayName, 'has a motion sensor.');
    }

    this.setupMotionFunction();
    this.setupMotionButton();
    this.setupLightButton();

  }

  private setupButtonService(
    serviceName: string,
    configValue: boolean | undefined,
    PropertyName: PropertyName,
    serviceType: 'switch' | 'lightbulb',
  ) {
    try {
      this.platform.log.debug(`${this.accessory.displayName} ${serviceName} config:`, configValue);
      if (configValue && this.device.hasProperty(PropertyName)) {
        // eslint-disable-next-line max-len
        this.platform.log.debug(`${this.accessory.displayName} has a ${PropertyName}, so append ${serviceType}${serviceName} characteristic to it.`);
        this.setupSwitchService(serviceName, serviceType, PropertyName);
      } else {
        // eslint-disable-next-line max-len
        this.platform.log.debug(`${this.accessory.displayName} Looks like not compatible with ${PropertyName} or this has been disabled within configuration`);
      }
    } catch (error) {
      this.platform.log.error(`${this.accessory.displayName} raise error to check and attach ${serviceType}${serviceName}.`, error);
      throw Error;
    }
  }

  private async setupEnableButton() {
    this.setupButtonService('Enabled', this.cameraConfig.enableButton, PropertyName.DeviceEnabled, 'switch');
  }

  private async setupMotionButton() {
    this.setupButtonService('Motion', this.cameraConfig.motionButton, PropertyName.DeviceMotionDetection, 'switch');
  }

  private async setupLightButton() {
    this.setupButtonService('Light', true, PropertyName.DeviceLight, 'lightbulb');
  }

  private getCameraConfig() {

    let config = {} as CameraConfig;

    if (typeof this.platform.config.cameras !== 'undefined') {
      // eslint-disable-next-line prefer-arrow-callback, brace-style
      const pos = this.platform.config.cameras.map(function (e) { return e.serialNumber; }).indexOf(this.device.getSerial());
      config = { ...this.platform.config.cameras[pos] };
    }

    config.name = this.accessory.displayName;
    config.enableButton = config.enableButton ??= true;
    config.motionButton = config.motionButton ??= true;
    config.rtsp = config.rtsp ??= false;
    config.forcerefreshsnap = config.forcerefreshsnap ??= false;
    config.videoConfig = config.videoConfig ??= {};
    config.useCachedLocalLivestream = config.useCachedLocalLivestream ??= false;
    config.immediateRingNotificationWithoutSnapshot = config.immediateRingNotificationWithoutSnapshot ??= false;
    config.delayCameraSnapshot = config.delayCameraSnapshot ??= false;

    if (!config.snapshotHandlingMethod) {
      config.snapshotHandlingMethod = (config.forcerefreshsnap) ? 1 : 3;
    }

    config.talkback = config.talkback ??= false;
    if (config.talkback && !this.device.hasCommand(CommandName.DeviceStartTalkback)) {
      this.platform.log.warn(this.accessory.displayName, 'Talkback for this device is not supported!');
      config.talkback = false;
    }
    if (config.talkback && config.rtsp) {
      this.platform.log.warn(this.accessory.displayName, 'Talkback cannot be used with rtsp option. Ignoring talkback setting.');
      config.talkback = false;
    }

    return config;
  }

  private cameraFunction() {

    this.registerCharacteristic({
      serviceType: this.platform.Service.CameraOperatingMode,
      characteristicType: this.platform.Characteristic.EventSnapshotsActive,
      getValue: (data) => this.handleDummyEventGet('EventSnapshotsActive'),
      setValue: (value) => this.handleDummyEventSet('EventSnapshotsActive', value),
    });

    this.registerCharacteristic({
      serviceType: this.platform.Service.CameraOperatingMode,
      characteristicType: this.platform.Characteristic.HomeKitCameraActive,
      // eslint-disable-next-line max-len
      getValue: (data) => this.getCameraPropertyValue('this.platform.Characteristic.HomeKitCameraActive', PropertyName.DeviceEnabled),
      // eslint-disable-next-line max-len
      setValue: (value) => this.setCameraPropertyValue('this.platform.Characteristic.HomeKitCameraActive', PropertyName.DeviceEnabled, value),
    });

    if (this.device.hasProperty('enabled')) {
      this.setupEnableButton();
      this.registerCharacteristic({
        serviceType: this.platform.Service.CameraOperatingMode,
        characteristicType: this.platform.Characteristic.ManuallyDisabled,
        // eslint-disable-next-line max-len
        getValue: (data) => this.getCameraPropertyValue('this.platform.Characteristic.ManuallyDisabled', PropertyName.DeviceEnabled),
      });
    }

    if (this.device.hasProperty('statusLed')) {
      this.registerCharacteristic({
        serviceType: this.platform.Service.CameraOperatingMode,
        characteristicType: this.platform.Characteristic.CameraOperatingModeIndicator,
        // eslint-disable-next-line max-len
        getValue: (data) => this.getCameraPropertyValue('this.platform.Characteristic.CameraOperatingModeIndicator', PropertyName.DeviceStatusLed),
        // eslint-disable-next-line max-len
        setValue: (value) => this.setCameraPropertyValue('this.platform.Characteristic.CameraOperatingModeIndicator', PropertyName.DeviceStatusLed, value),
      });
    }

    if (this.device.hasProperty('nightvision')) {
      this.registerCharacteristic({
        serviceType: this.platform.Service.CameraOperatingMode,
        characteristicType: this.platform.Characteristic.NightVision,
        // eslint-disable-next-line max-len
        getValue: (data) => this.getCameraPropertyValue('this.platform.Characteristic.NightVision', PropertyName.DeviceNightvision),
        // eslint-disable-next-line max-len
        setValue: (value) => this.setCameraPropertyValue('this.platform.Characteristic.NightVision', PropertyName.DeviceNightvision, value),
      });
    }

    if (this.device.hasProperty('autoNightvision')) {
      this.registerCharacteristic({
        serviceType: this.platform.Service.CameraOperatingMode,
        characteristicType: this.platform.Characteristic.NightVision,
        // eslint-disable-next-line max-len
        getValue: (data) => this.getCameraPropertyValue('this.platform.Characteristic.NightVision', PropertyName.DeviceAutoNightvision),
        // eslint-disable-next-line max-len
        setValue: (value) => this.setCameraPropertyValue('this.platform.Characteristic.NightVision', PropertyName.DeviceAutoNightvision, value),
      });
    }

    if (this.device.isDoorbell()) {
      this.registerCharacteristic({
        serviceType: this.platform.Service.Doorbell,
        characteristicType: this.platform.Characteristic.ProgrammableSwitchEvent,
        getValue: (data) => this.handleDummyEventGet('EventSnapshotsActive'),
        onValue: (service, characteristic) => {
          this.device.on('rings', (device: Device, state: boolean) =>
            this.onDeviceRingsPushNotification(characteristic),
          );
        },
      });
    }

    this.getService(this.platform.Service.CameraOperatingMode).setPrimaryService(true);

  }

  private setupMotionFunction() {
    try {

      // List of event types
      const eventTypesToHandle: (keyof DeviceEvents)[] = [
        'motion detected',
        'person detected',
        'pet detected',
        'vehicle detected',
        'sound detected',
        'crying detected',
        'dog detected',
        'stranger person detected',
      ];

      this.registerCharacteristic({
        serviceType: this.platform.Service.MotionSensor,
        characteristicType: this.platform.Characteristic.MotionDetected,
        getValue: (data) => this.device.getPropertyValue(PropertyName.DeviceMotionDetected),
        onMultipleValue: eventTypesToHandle,
      });

    } catch (error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach motion function.', error);
      throw Error;
    }
  }

  private setupSwitchService(
    serviceName: string,
    serviceType: 'switch' | 'lightbulb' | 'outlet',
    propertyName: PropertyName,
  ) {
    const platformServiceMapping = {
      switch: this.platform.Service.Switch,
      lightbulb: this.platform.Service.Lightbulb,
      outlet: this.platform.Service.Outlet,
    };

    this.registerCharacteristic({
      serviceType: platformServiceMapping[serviceType] || this.platform.Service.Switch,
      characteristicType: this.platform.Characteristic.On,
      name: this.accessory.displayName + '_' + serviceName,
      serviceSubType: serviceName,
      getValue: (data) => this.getCameraPropertyValue('this.platform.Characteristic.On', propertyName),
      setValue: (value) => this.setCameraPropertyValue('this.platform.Characteristic.On', propertyName, value),
    });
  }

  protected getCameraPropertyValue(characteristic: string, propertyName: PropertyName): CharacteristicValue {
    try {
      let value = this.device.getPropertyValue(propertyName);
      this.platform.log.debug(`${this.accessory.displayName} GET '${characteristic}' ${propertyName}: ${value}`);

      if (propertyName === PropertyName.DeviceNightvision) {
        return value === 1;
      }

      // Override for PropertyName.DeviceEnabled when enabled button is fired and 
      if (
        propertyName === PropertyName.DeviceEnabled &&
        Date.now() - this.cameraStatus.timestamp <= 60000
      ) {
        // eslint-disable-next-line max-len
        this.platform.log.debug(`${this.accessory.displayName} CACHED for (1 min) '${characteristic}' ${propertyName}: ${this.cameraStatus.isEnabled}`);
        value = this.cameraStatus.isEnabled;
      }

      if (characteristic === 'this.platform.Characteristic.ManuallyDisabled') {
        this.platform.log.debug(`${this.accessory.displayName} INVERSED '${characteristic}' ${propertyName}: ${!value}`);
        value = !value;
      }

      if (value === undefined) {
        return false;
      }

      return value as CharacteristicValue;
    } catch (error) {
      this.platform.log.debug(`${this.accessory.displayName} Error getting '${characteristic}' ${propertyName}: ${error}`);
      return false;
    }
  }

  protected async setCameraPropertyValue(characteristic: string, propertyName: PropertyName, value: CharacteristicValue) {
    try {

      // eslint-disable-next-line max-len
      this.platform.log.debug(`${this.accessory.displayName} SET '${typeof characteristic} / ${characteristic}' ${propertyName}: ${value}`);

      const station = await this.platform.getStationById(this.device.getStationSerial());

      const cameraService = this.getService(this.platform.Service.CameraOperatingMode);

      switch (propertyName) {
        case PropertyName.DeviceEnabled: {
          if (characteristic === 'this.platform.Characteristic.On') {
            this.cameraStatus = { isEnabled: value as boolean, timestamp: Date.now() };
            await station.enableDevice(this.device, value as boolean);
            cameraService.updateCharacteristic(this.platform.Characteristic.ManuallyDisabled, !value as boolean);
          }
          break;
        }

        case PropertyName.DeviceMotionDetection: {
          await station.setMotionDetection(this.device, value as boolean);
          cameraService.updateCharacteristic(this.platform.Characteristic.CameraOperatingModeIndicator, value as boolean);
          break;
        }

        case PropertyName.DeviceStatusLed: {
          await station.setStatusLed(this.device, value as boolean);
          cameraService.updateCharacteristic(this.platform.Characteristic.CameraOperatingModeIndicator, value as boolean);
          break;
        }

        case PropertyName.DeviceNightvision: {
          // Convert true to 1 (B&W Night Vision) and false to 0 (off)
          await station.setNightVision(this.device, Number(value) as number);
          cameraService.updateCharacteristic(this.platform.Characteristic.NightVision, value as boolean);
          break;
        }

        case PropertyName.DeviceAutoNightvision: {
          await station.setAutoNightVision(this.device, value as boolean);
          cameraService.updateCharacteristic(this.platform.Characteristic.NightVision, value as boolean);
          break;
        }

        case PropertyName.DeviceLight: {
          await station.switchLight(this.device, value as boolean);
          // this.service.updateCharacteristic(this.platform.Characteristic.On, value as boolean);
          break;
        }

        default: {
          // eslint-disable-next-line max-len
          this.platform.log.error(`${this.accessory.displayName} Shouldn't Match '${characteristic}' ${propertyName}: ${value}`);
          throw Error;
          break;
        }
      }

    } catch (error) {
      this.platform.log.debug(`${this.accessory.displayName} Error setting '${characteristic}' ${propertyName}: ${error}`);
    }
  }

  handleDummyEventGet(serviceName: string): Promise<CharacteristicValue> {
    const characteristicValues: Record<string, CharacteristicValue> = {
      'EventSnapshotsActive': this.platform.Characteristic.EventSnapshotsActive.DISABLE,
      'HomeKitCameraActive': this.platform.Characteristic.HomeKitCameraActive.OFF,
    };

    const currentValue = characteristicValues[serviceName];

    if (currentValue === undefined) {
      throw new Error(`Invalid serviceName: ${serviceName}`);
    }

    this.platform.log.debug(`${this.accessory.displayName} GET ${serviceName}: ${currentValue}`);
    return Promise.resolve(currentValue);
  }

  handleDummyEventSet(serviceName: string, value: CharacteristicValue) {
    this.platform.log.debug(`${this.accessory.displayName} SET ${serviceName}: ${value}`);
  }

  // We receive 2 push when Doorbell ring, mute the second by checking if we already send
  // the event to HK then reset the marker when 2nd times occurs
  private onDeviceRingsPushNotification(characteristic: Characteristic): void {
    if (!this.ring_triggered) {
      this.ring_triggered = true;
      this.platform.log.debug(this.accessory.displayName, 'DoorBell ringing');
      if (this.cameraConfig.useCachedLocalLivestream && this.streamingDelegate) {
        this.streamingDelegate.prepareCachedStream();
      }
      characteristic.updateValue(this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
    } else {
      this.ring_triggered = false;
    }
  }

}
