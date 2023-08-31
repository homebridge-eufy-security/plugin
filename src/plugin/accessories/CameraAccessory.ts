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

  protected CameraService: Service;

  // Define the object variable to hold the boolean and timestamp
  protected cameraStatus: { isEnabled: boolean; timestamp: number };

  public readonly cameraConfig: CameraConfig;

  protected streamingDelegate: StreamingDelegate | null = null;

  private motionTimeout?: NodeJS.Timeout;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: Camera,
  ) {
    super(platform, accessory, device);

    this.CameraService = {} as Service;
    this.cameraConfig = {} as CameraConfig;

    this.cameraStatus = { isEnabled: false, timestamp: 0 }; // Initialize the cameraStatus object

    this.platform.log.debug(this.accessory.displayName, 'Constructed Camera');

    this.cameraConfig = this.getCameraConfig();
    this.platform.log.debug(this.accessory.displayName, 'config is:', this.cameraConfig);

    if (this.cameraConfig.enableCamera || (typeof this.device.isDoorbell === 'function' && this.device.isDoorbell())) {
      this.platform.log.debug(this.accessory.displayName, 'has a camera');

      try {
        this.CameraService = this.cameraFunction();
        this.CameraService.setPrimaryService(true);
        const delegate = new StreamingDelegate(this.platform, device, this.cameraConfig, this.platform.api, this.platform.api.hap);
        this.streamingDelegate = delegate;
        accessory.configureController(delegate.controller);
      } catch (error) {
        this.platform.log.error(this.accessory.displayName, 'raise error to check and attach livestream function.', error);
      }

    } else {
      this.platform.log.debug(this.accessory.displayName, 'has a motion sensor.');
    }

    this.setupMotionFunction(accessory);
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
      if (configValue && this.device.hasProperty(PropertyName)) {
        // eslint-disable-next-line max-len
        this.platform.log.debug(`${this.accessory.displayName} has a ${PropertyName}, so append ${serviceType}${serviceName} characteristic to it.`);
        const newService = this.setupSwitchService(serviceName, serviceType, PropertyName);
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

  private cameraFunction(): Service {
    const service =
      this.accessory.getService(this.platform.Service.CameraOperatingMode) ||
      this.accessory.addService(this.platform.Service.CameraOperatingMode);

    service.setCharacteristic(
      this.platform.Characteristic.Name,
      this.accessory.displayName,
    );

    service.getCharacteristic(this.platform.Characteristic.EventSnapshotsActive)
      .onGet(this.handleDummyEventGet.bind(this, 'EventSnapshotsActive'))
      .onSet(this.handleDummyEventSet.bind(this, 'EventSnapshotsActive'));

    service.getCharacteristic(this.platform.Characteristic.HomeKitCameraActive)
      .onGet(this.getCameraPropertyValue.bind(this, 'this.platform.Characteristic.HomeKitCameraActive', PropertyName.DeviceEnabled))
      .onSet(this.setCameraPropertyValue.bind(this, 'this.platform.Characteristic.HomeKitCameraActive', PropertyName.DeviceEnabled));


    if (this.device.hasProperty('enabled')) {
      service.getCharacteristic(this.platform.Characteristic.ManuallyDisabled)
        .onGet(this.getCameraPropertyValue.bind(this, 'this.platform.Characteristic.ManuallyDisabled', PropertyName.DeviceEnabled));
    }

    if (this.device.hasProperty('statusLed')) {
      service.getCharacteristic(this.platform.Characteristic.CameraOperatingModeIndicator)
        // eslint-disable-next-line max-len
        .onGet(this.getCameraPropertyValue.bind(this, 'this.platform.Characteristic.CameraOperatingModeIndicator', PropertyName.DeviceStatusLed))
        // eslint-disable-next-line max-len
        .onSet(this.setCameraPropertyValue.bind(this, 'this.platform.Characteristic.CameraOperatingModeIndicator', PropertyName.DeviceStatusLed));
    }

    if (this.device.hasProperty('nightvision')) {
      service.getCharacteristic(this.platform.Characteristic.NightVision)
        .onGet(this.getCameraPropertyValue.bind(this, 'this.platform.Characteristic.NightVision', PropertyName.DeviceNightvision))
        .onSet(this.setCameraPropertyValue.bind(this, 'this.platform.Characteristic.NightVision', PropertyName.DeviceNightvision));
    }

    if (this.device.hasProperty('autoNightvision')) {
      service.getCharacteristic(this.platform.Characteristic.NightVision)
        .onGet(this.getCameraPropertyValue.bind(this, 'this.platform.Characteristic.NightVision', PropertyName.DeviceAutoNightvision))
        .onSet(this.setCameraPropertyValue.bind(this, 'this.platform.Characteristic.NightVision', PropertyName.DeviceAutoNightvision));
    }

    this.device.on('property changed', (device: Device, name: string, value: PropertyValue) =>
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
        this.platform.Characteristic.Name,
        this.accessory.displayName,
      );

      service.getCharacteristic(this.platform.Characteristic.MotionDetected)
        .onGet(this.getCameraPropertyValue.bind(this, 'this.platform.Characteristic.MotionDetected', PropertyName.DeviceMotionDetected));

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
        this.device.on(eventType, (device: Device, motion: boolean) =>
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
        // this.service
        //   .getCharacteristic(this.platform.Characteristic.MotionDetected)
        //   .updateValue(false);
      }, 15000);
    } else {
      if (this.motionTimeout) {
        clearTimeout(this.motionTimeout);
      }
    }
    if (this.cameraConfig.useCachedLocalLivestream && this.streamingDelegate && motion) {
      this.streamingDelegate.prepareCachedStream();
    }
    // this.service
    //   .getCharacteristic(this.platform.Characteristic.MotionDetected)
    //   .updateValue(motion);
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
      this.platform.Characteristic.Name,
      this.accessory.displayName + ' ' + serviceName,
    );

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getCameraPropertyValue.bind(this, 'this.platform.Characteristic.On', propertyName))
      .onSet(this.setCameraPropertyValue.bind(this, 'this.platform.Characteristic.On', propertyName));

    return service;
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

      switch (propertyName) {
        case PropertyName.DeviceEnabled: {
          if (characteristic === 'this.platform.Characteristic.On') {
            this.cameraStatus = { isEnabled: value as boolean, timestamp: Date.now() };
            await station.enableDevice(this.device, value as boolean);
            this.CameraService.updateCharacteristic(this.platform.Characteristic.ManuallyDisabled, !value as boolean);
          }
          break;
        }

        case PropertyName.DeviceMotionDetection: {
          await station.setMotionDetection(this.device, value as boolean);
          this.CameraService.updateCharacteristic(this.platform.Characteristic.CameraOperatingModeIndicator, value as boolean);
          break;
        }

        case PropertyName.DeviceStatusLed: {
          await station.setStatusLed(this.device, value as boolean);
          this.CameraService.updateCharacteristic(this.platform.Characteristic.CameraOperatingModeIndicator, value as boolean);
          break;
        }

        case PropertyName.DeviceNightvision: {
          // Convert true to 1 (B&W Night Vision) and false to 0 (off)
          await station.setNightVision(this.device, Number(value) as number);
          this.CameraService.updateCharacteristic(this.platform.Characteristic.NightVision, value as boolean);
          break;
        }

        case PropertyName.DeviceAutoNightvision: {
          await station.setAutoNightVision(this.device, value as boolean);
          this.CameraService.updateCharacteristic(this.platform.Characteristic.NightVision, value as boolean);
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
}
