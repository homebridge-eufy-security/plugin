import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Camera, Device, PropertyName, CommandName, VideoCodec } from 'eufy-security-client';
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

    this.platform.log.debug(this.accessory.displayName, 'Constructed Camera');

    this.cameraConfig = this.getCameraConfig();
    this.platform.log.debug(this.accessory.displayName, 'config is:', this.cameraConfig);

    if (this.cameraConfig.enableCamera || (typeof this.eufyDevice.isDoorbell === 'function' && this.eufyDevice.isDoorbell())) {
      this.platform.log.debug(this.accessory.displayName, 'has a camera');

      try {
        this.CameraService = this.cameraFunction(accessory);
        this.CameraService.setPrimaryService(true);
        const delegate = new StreamingDelegate(this.platform, eufyDevice, this.cameraConfig, this.platform.api, this.platform.api.hap);
        this.streamingDelegate = delegate;
        accessory.configureController(delegate.controller);
      } catch (Error) {
        this.platform.log.error(this.accessory.displayName, 'raise error to check and attach livestream function.', Error);
      }

    } else {
      this.platform.log.debug(this.accessory.displayName, 'has a motion sensor.');
    }

    this.service = this.setupMotionFunction(accessory);
    this.setupEnableButton();
    this.setupMotionButton();
    this.setupLightButton();

  }

  private setupButtonService(serviceName: string, configValue: boolean | undefined, PropertyName: PropertyName, serviceType: 'switch' | 'lightbulb') {
    try {
      this.platform.log.debug(this.accessory.displayName, `${serviceName} config:`, configValue);
      if (configValue && this.eufyDevice.hasProperty(PropertyName)) {
        this.platform.log.debug(this.accessory.displayName, `has a ${PropertyName}, so append ${serviceType}${serviceName} characteristic to it.`);
        this.setupSwitchService(serviceName, serviceType, configValue, PropertyName);
      } else {
        this.platform.log.debug(this.accessory.displayName, `Looks like not compatible with ${PropertyName} or this has been disabled within configuration`);
      }
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, `raise error to check and attach ${serviceType}${serviceName}.`, Error);
    }
  }

  private setupEnableButton() {
    this.setupButtonService('Enabled', this.cameraConfig.enableButton, PropertyName.DeviceEnabled, 'switch');
  }

  private setupMotionButton() {
    this.setupButtonService('Motion', this.cameraConfig.motionButton, PropertyName.DeviceMotionDetection, 'switch');
  }

  private setupLightButton() {
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

  private cameraFunction(
    accessory: PlatformAccessory,
  ): Service {
    const service =
      this.accessory.getService(this.platform.Service.CameraOperatingMode) ||
      this.accessory.addService(this.platform.Service.CameraOperatingMode);

    service.setCharacteristic(
      this.characteristic.Name,
      this.accessory.displayName,
    );

    service
      .getCharacteristic(this.characteristic.EventSnapshotsActive)
      .onGet(this.handleEventSnapshotsActiveGet.bind(this));
    service
      .getCharacteristic(this.characteristic.EventSnapshotsActive)
      .onSet(this.handleEventSnapshotsActiveSet.bind(this));

    service
      .getCharacteristic(this.characteristic.HomeKitCameraActive)
      .onGet(this.handleHomeKitCameraActiveGet.bind(this));
    service
      .getCharacteristic(this.characteristic.HomeKitCameraActive)
      .onSet(this.handleHomeKitCameraActiveSet.bind(this));

    if (this.eufyDevice.hasProperty('enabled')) {
      service
        .getCharacteristic(this.characteristic.ManuallyDisabled)
        .onGet(this.handleManuallyDisabledGet.bind(this));
    }

    if (this.eufyDevice.hasProperty('statusLed')) {
      service
        .getCharacteristic(this.characteristic.CameraOperatingModeIndicator)
        .onGet(this.handleHomeKitCameraOperatingModeIndicatorGet.bind(this))
        .onSet(this.handleHomeKitCameraOperatingModeIndicatorSet.bind(this));
    }

    if (this.eufyDevice.hasProperty('nightvision')) {
      service
        .getCharacteristic(this.characteristic.NightVision)
        .onGet(this.handleHomeKitNightVisionGet.bind(this))
        .onSet(this.handleHomeKitNightVisionSet.bind(this));
    }

    return service as Service;
  }

  handleEventSnapshotsActiveGet(): Promise<CharacteristicValue> {
    const currentValue = this.characteristic.EventSnapshotsActive.DISABLE;
    this.platform.log.debug(this.accessory.displayName, 'GET EventSnapshotsActive:', currentValue);
    return currentValue;
  }

  /**
   * Handle requests to set the "Event Snapshots Active" characteristic
   */
  handleEventSnapshotsActiveSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'SET EventSnapshotsActive:', value);
  }

  /**
   * Handle requests to get the current value of the "HomeKit Camera Active" characteristic
   */
  handleHomeKitCameraActiveGet(): Promise<CharacteristicValue> {
    const currentValue = this.characteristic.HomeKitCameraActive.OFF;
    this.platform.log.debug(this.accessory.displayName, 'GET HomeKitCameraActive:', currentValue);
    return currentValue;
  }

  /**
   * Handle requests to set the "HomeKit Camera Active" characteristic
   */
  handleHomeKitCameraActiveSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'SET HomeKitCameraActive:', value);
  }

  /**
   * Handle requests to get the current value of the "HomeKit Camera Active" characteristic
   */
  async handleHomeKitCameraOperatingModeIndicatorGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = this.eufyDevice.getPropertyValue(PropertyName.DeviceStatusLed);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceStatusLed:', currentValue);
      return currentValue as boolean;
    } catch {
      this.platform.log.debug(this.accessory.displayName, 'handleHomeKitCameraOperatingModeIndicatorGet', 'Wrong return value');
      return false;
    }
  }

  /**
   * Handle requests to set the "HomeKit Camera Active" characteristic
   */
  async handleHomeKitCameraOperatingModeIndicatorSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'SET HomeKitCameraOperatingModeIndicator:', value);
    const station = await this.platform.getStationById(this.eufyDevice.getStationSerial());
    station.setStatusLed(this.eufyDevice, value as boolean);
    this.CameraService.getCharacteristic(this.characteristic.CameraOperatingModeIndicator).updateValue(value as boolean);
  }

  /**
   * Handle requests to get the current value of the "HomeKit Camera Active" characteristic
   */
  async handleHomeKitNightVisionGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = this.eufyDevice.getPropertyValue(PropertyName.DeviceNightvision);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceNightvision:', currentValue);
      return currentValue as boolean;
    } catch {
      this.platform.log.debug(this.accessory.displayName, 'handleHomeKitNightVisionGet', 'Wrong return value');
      return false;
    }
  }

  /**
   * Handle requests to set the "HomeKit Camera Active" characteristic
   */
  async handleHomeKitNightVisionSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'SET handleHomeKitNightVisionSet:', value);
    const station = await this.platform.getStationById(this.eufyDevice.getStationSerial());
    station.setNightVision(this.eufyDevice, value as number);
    this.CameraService.getCharacteristic(this.characteristic.NightVision).updateValue(value as boolean);
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

      service
        .getCharacteristic(this.characteristic.MotionDetected)
        .onGet(this.handleMotionDetectedGet.bind(this));

      this.eufyDevice.on('motion detected', (device: Device, motion: boolean) =>
        this.onDeviceMotionDetectedPushNotification(device, motion),
      );

      this.eufyDevice.on('person detected', (device: Device, motion: boolean) =>
        this.onDeviceMotionDetectedPushNotification(device, motion),
      );

      this.eufyDevice.on('pet detected', (device: Device, motion: boolean) =>
        this.onDeviceMotionDetectedPushNotification(device, motion),
      );

      return service as Service;
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach motion function.', Error);
      throw Error;
    }
  }

  async handleMotionDetectedGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = this.eufyDevice.getPropertyValue(PropertyName.DeviceMotionDetected);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceMotionDetected:', currentValue);
      return currentValue as boolean;
    } catch {
      this.platform.log.debug(this.accessory.displayName, 'handleMotionDetectedGet', 'Wrong return value');
      return false;
    }
  }

  private onDeviceMotionDetectedPushNotification(
    device: Device,
    motion: boolean,
  ): void {
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
    this.platform.log.debug(this.accessory.displayName, 'ON DeviceMotionDetected:', motion);
    if (this.cameraConfig.useCachedLocalLivestream && this.streamingDelegate && motion) {
      this.streamingDelegate.prepareCachedStream();
    }
    this.service
      .getCharacteristic(this.characteristic.MotionDetected)
      .updateValue(motion);
  }

  async handleManuallyDisabledGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = this.eufyDevice.getPropertyValue(PropertyName.DeviceEnabled);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceEnabled:', currentValue);
      return !currentValue as boolean;
    } catch {
      this.platform.log.debug(this.accessory.displayName, 'handleManuallyDisabledGet', 'Wrong return value');
      return false;
    }
  }

  private setupSwitchService(
    serviceName: string,
    serviceType: 'switch' | 'lightbulb',
    configValue: boolean | undefined,
    propertyName: PropertyName
  ) {
    if (configValue && this.eufyDevice.hasProperty(propertyName)) {

      const platformService = 'lightbulb' ? this.platform.Service.Lightbulb : this.platform.Service.Switch

      const service =
        this.accessory.getService(serviceType) ||
        this.accessory.addService(platformService, serviceType);

      service.setCharacteristic(
        this.characteristic.Name,
        this.accessory.displayName + ' ' + serviceName
      );

      service.getCharacteristic(this.characteristic.On)
        .onGet(this.getPropertyValue.bind(this, propertyName))
        .onSet(this.setPropertyValue.bind(this, propertyName));
    } else {
      this.platform.log.debug(this.accessory.displayName, `Looks like not compatible with ${propertyName} or this has been disabled within configuration`);
    }
  }

  private async getPropertyValue(propertyName: PropertyName): Promise<CharacteristicValue> {
    try {
      const value = await this.eufyDevice.getPropertyValue(propertyName);
      this.platform.log.debug(this.accessory.displayName, `GET ${propertyName}:`, value);
      return value as boolean;
    } catch (error) {
      this.platform.log.debug(this.accessory.displayName, `Error getting ${propertyName}:`, error);
      return false;
    }
  }

  private async setPropertyValue(propertyName: string, value: CharacteristicValue) {
    try {
      this.platform.log.debug(this.accessory.displayName, `SET ${propertyName}:`, value);
      const station = await this.platform.getStationById(this.eufyDevice.getStationSerial());

      if (propertyName === 'DeviceEnabled') {
        station.enableDevice(this.eufyDevice, value as boolean);
        if (this.cameraConfig.enableCamera) {
          this.CameraService.getCharacteristic(this.characteristic.ManuallyDisabled).updateValue(!value as boolean);
        }
      } else if (propertyName === 'DeviceMotionDetection') {
        station.setMotionDetection(this.eufyDevice, value as boolean);
      } else if (propertyName === 'DeviceLight') {
        station.switchLight(this.eufyDevice, value as boolean);
      }
    } catch (error) {
      this.platform.log.error(this.accessory.displayName, `Error setting ${propertyName}:`, error);
    }
  }
}
