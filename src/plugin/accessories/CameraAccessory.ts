import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Camera, Device, DeviceEvents, PropertyName, CommandName, PropertyValue } from 'eufy-security-client';
import { StreamingDelegate } from '../controller/streamingDelegate';

import { CameraConfig, VideoConfig } from '../utils/configTypes';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class CameraAccessory extends DeviceAccessory {

  protected service: Service;
  protected CameraService: Service;

  // Define the object variable to hold the boolean and timestamp
  protected cameraStatus: { isEnabled: boolean; timestamp: number };

  public readonly cameraConfig: CameraConfig;

  protected streamingDelegate: StreamingDelegate | null = null;

  private motionTimeout?: NodeJS.Timeout;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: Camera,
  ) {
    super(platform, accessory, eufyDevice);

    this.service = {} as Service;
    this.CameraService = {} as Service;
    this.cameraConfig = {} as CameraConfig;

    this.cameraStatus = { isEnabled: false, timestamp: 0 }; // Initialize the cameraStatus object

    this.platform.log.debug(this.accessory.displayName, 'Constructed Camera');

    this.cameraConfig = this.getCameraConfig();
    this.platform.log.debug(this.accessory.displayName, 'config is:', this.cameraConfig);

    if (this.cameraConfig.enableCamera || (typeof this.eufyDevice.isDoorbell === 'function' && this.eufyDevice.isDoorbell())) {
      this.platform.log.debug(this.accessory.displayName, 'has a camera');

      try {
        this.CameraService = this.cameraFunction();
        this.CameraService.setPrimaryService(true);
        const delegate = new StreamingDelegate(this.platform, eufyDevice, this.cameraConfig, this.platform.api, this.platform.api.hap);
        this.streamingDelegate = delegate;
        accessory.configureController(delegate.controller);
      } catch (error) {
        this.platform.log.error(this.accessory.displayName, 'raise error to check and attach livestream function.', error);
      }

    } else {
      this.platform.log.debug(this.accessory.displayName, 'has a motion sensor.');
    }

    this.service = this.setupMotionFunction(accessory);
    this.setupEnableButton();
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
      if (configValue && this.eufyDevice.hasProperty(PropertyName)) {
        // eslint-disable-next-line max-len
        this.platform.log.debug(`${this.accessory.displayName} has a ${PropertyName}, so append ${serviceType}${serviceName} characteristic to it.`);
        const newService = this.setupSwitchService(serviceName, serviceType, PropertyName);
        this.service.addLinkedService(newService);
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
      const pos = this.platform.config.cameras.map(function (e) { return e.serialNumber; }).indexOf(this.eufyDevice.getSerial());
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
    if (config.talkback && !this.eufyDevice.hasCommand(CommandName.DeviceStartTalkback)) {
      this.platform.log.warn(this.accessory.displayName, 'Talkback for this device is not supported!');
      config.talkback = false;
    }
    if (config.talkback && config.rtsp) {
      this.platform.log.warn(this.accessory.displayName, 'Talkback cannot be used with rtsp option. Ignoring talkback setting.');
      config.talkback = false;
    }

    return config;
  }

  private cameraFunction(): Service {
    const service =
      this.accessory.getService(this.platform.Service.CameraOperatingMode) ||
      this.accessory.addService(this.platform.Service.CameraOperatingMode);

    service.setCharacteristic(
      this.characteristic.Name,
      this.accessory.displayName,
    );

    service.getCharacteristic(this.characteristic.EventSnapshotsActive)
      .onGet(this.handleDummyEventGet.bind(this, 'EventSnapshotsActive'))
      .onSet(this.handleDummyEventSet.bind(this, 'EventSnapshotsActive'));

    service.getCharacteristic(this.characteristic.HomeKitCameraActive)
      .onGet(this.getPropertyValue.bind(this, 'this.characteristic.HomeKitCameraActive', PropertyName.DeviceEnabled))
      .onSet(this.getPropertyValue.bind(this, 'this.characteristic.HomeKitCameraActive', PropertyName.DeviceEnabled));


    if (this.eufyDevice.hasProperty('enabled')) {
      service.getCharacteristic(this.characteristic.ManuallyDisabled)
        .onGet(this.getPropertyValue.bind(this, 'this.characteristic.ManuallyDisabled', PropertyName.DeviceEnabled));
    }

    if (this.eufyDevice.hasProperty('statusLed')) {
      service.getCharacteristic(this.characteristic.CameraOperatingModeIndicator)
        .onGet(this.getPropertyValue.bind(this, 'this.characteristic.CameraOperatingModeIndicator', PropertyName.DeviceStatusLed))
        .onSet(this.setPropertyValue.bind(this, 'this.characteristic.CameraOperatingModeIndicator', PropertyName.DeviceStatusLed));
    }

    if (this.eufyDevice.hasProperty('nightvision')) {
      service.getCharacteristic(this.characteristic.NightVision)
        .onGet(this.getPropertyValue.bind(this, 'this.characteristic.NightVision', PropertyName.DeviceNightvision))
        .onSet(this.setPropertyValue.bind(this, 'this.characteristic.NightVision', PropertyName.DeviceNightvision));
    }

    if (this.eufyDevice.hasProperty('autoNightvision')) {
      service.getCharacteristic(this.characteristic.NightVision)
        .onGet(this.getPropertyValue.bind(this, 'this.characteristic.NightVision', PropertyName.DeviceAutoNightvision))
        .onSet(this.setPropertyValue.bind(this, 'this.characteristic.NightVision', PropertyName.DeviceAutoNightvision));
    }

    this.eufyDevice.on('property changed', (device: Device, name: string, value: PropertyValue) =>
      this.handlePropertyChange(device, name, value),
    );

    return service as Service;
  }

  private setupMotionFunction(
    accessory: PlatformAccessory,
  ): Service {
    try {
      const service =
        this.accessory.getService(this.platform.Service.MotionSensor) ||
        this.accessory.addService(this.platform.Service.MotionSensor);

      service.setCharacteristic(
        this.characteristic.Name,
        this.accessory.displayName,
      );

      service.getCharacteristic(this.characteristic.MotionDetected)
        .onGet(this.getPropertyValue.bind(this, 'this.characteristic.MotionDetected', PropertyName.DeviceMotionDetected));

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

      // Attach the common event handler to each event type
      eventTypesToHandle.forEach(eventType => {
        this.platform.log.debug(this.accessory.displayName, 'SETON Firing on:', eventType);
        this.eufyDevice.on(eventType, (device: Device, motion: boolean) =>
          this.onDeviceEventDetectedPushNotification(device, motion, eventType));
      });

      return service as Service;
    } catch (error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach motion function.', error);
      throw Error;
    }
  }

  private onDeviceEventDetectedPushNotification(
    device: Device,
    motion: boolean,
    eventType: string,
  ): void {
    this.platform.log.info(`${this.accessory.displayName} ON Event Detected (${eventType}): ${motion}`);
    if (motion) {
      this.motionTimeout = setTimeout(() => {
        this.platform.log.debug(this.accessory.displayName, 'Reseting motion through timout.');
        this.service
          .getCharacteristic(this.characteristic.MotionDetected)
          .updateValue(false);
      }, 15000);
    } else {
      if (this.motionTimeout) {
        clearTimeout(this.motionTimeout);
      }
    }
    if (this.cameraConfig.useCachedLocalLivestream && this.streamingDelegate && motion) {
      this.streamingDelegate.prepareCachedStream();
    }
    this.service
      .getCharacteristic(this.characteristic.MotionDetected)
      .updateValue(motion);
  }

  private setupSwitchService(
    serviceName: string,
    serviceType: 'switch' | 'lightbulb' | 'outlet',
    propertyName: PropertyName,
  ): Service {
    const platformServiceMapping = {
      switch: this.platform.Service.Switch,
      lightbulb: this.platform.Service.Lightbulb,
      outlet: this.platform.Service.Outlet,
    };

    const platformService = platformServiceMapping[serviceType] || this.platform.Service.Switch;

    const service =
      this.accessory.getService(serviceName) ||
      this.accessory.addService(platformService, serviceName, serviceName);

    service.setCharacteristic(
      this.characteristic.Name,
      this.accessory.displayName + ' ' + serviceName,
    );

    service.getCharacteristic(this.characteristic.On)
      .onGet(this.getPropertyValue.bind(this, 'this.characteristic.On', propertyName))
      .onSet(this.setPropertyValue.bind(this, 'this.characteristic.On', propertyName));

    return service;
  }

  private async getPropertyValue(characteristic: string, propertyName: PropertyName): Promise<CharacteristicValue> {
    try {
      let value = await this.eufyDevice.getPropertyValue(propertyName);
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

      if (characteristic === 'this.characteristic.ManuallyDisabled') {
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

  private async setPropertyValue(characteristic: string, propertyName: PropertyName, value: CharacteristicValue) {
    try {

      // eslint-disable-next-line max-len
      this.platform.log.debug(`${this.accessory.displayName} SET '${typeof characteristic} / ${characteristic}' ${propertyName}: ${value}`);

      const station = await this.platform.getStationById(this.eufyDevice.getStationSerial());

      switch (propertyName) {
        case PropertyName.DeviceEnabled: {
          if (characteristic === 'this.characteristic.On') {
            this.cameraStatus = { isEnabled: value as boolean, timestamp: Date.now() };
            await station.enableDevice(this.eufyDevice, value as boolean);
            this.CameraService.updateCharacteristic(this.characteristic.ManuallyDisabled, !value as boolean);
          }
          break;
        }

        case PropertyName.DeviceMotionDetection: {
          await station.setMotionDetection(this.eufyDevice, value as boolean);
          this.CameraService.updateCharacteristic(this.characteristic.CameraOperatingModeIndicator, value as boolean);
          break;
        }

        case PropertyName.DeviceStatusLed: {
          await station.setStatusLed(this.eufyDevice, value as boolean);
          this.CameraService.updateCharacteristic(this.characteristic.CameraOperatingModeIndicator, value as boolean);
          break;
        }

        case PropertyName.DeviceNightvision: {
          // Convert true to 1 (B&W Night Vision) and false to 0 (off)
          await station.setNightVision(this.eufyDevice, Number(value) as number);
          this.CameraService.updateCharacteristic(this.characteristic.NightVision, value as boolean);
          break;
        }

        case PropertyName.DeviceAutoNightvision: {
          await station.setAutoNightVision(this.eufyDevice, value as boolean);
          this.CameraService.updateCharacteristic(this.characteristic.NightVision, value as boolean);
          break;
        }

        case PropertyName.DeviceLight: {
          await station.switchLight(this.eufyDevice, value as boolean);
          this.service.updateCharacteristic(this.characteristic.On, value as boolean);
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

  protected override handlePropertyChange(
    device: Device,
    name: string,
    value: PropertyValue,
  ): void {
    switch (name) {
      case 'enabled': {
        break;
      }

      case 'statusLed': {
        break;
      }

      default: {
        break;
      }
    }
  }

  handleDummyEventGet(serviceName: string): Promise<CharacteristicValue> {
    const characteristicValues: Record<string, CharacteristicValue> = {
      'EventSnapshotsActive': this.characteristic.EventSnapshotsActive.DISABLE,
      'HomeKitCameraActive': this.characteristic.HomeKitCameraActive.OFF,
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
}
