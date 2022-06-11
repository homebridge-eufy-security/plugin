import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Camera, Device, PropertyName, VideoCodec } from 'eufy-security-client';
import { StreamingDelegate } from './streamingDelegate';

import { CameraConfig, VideoConfig } from './configTypes';

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

    try {
      this.service = this.motionFunction(accessory);
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach motion function.', Error);
    }

    try {
      this.platform.log.debug(this.accessory.displayName, 'enableButton config:', this.cameraConfig.enableButton);
      if ((this.cameraConfig.enableCamera || (typeof this.eufyDevice.isDoorbell === 'function' && this.eufyDevice.isDoorbell()))
        && this.cameraConfig.enableButton
        && this.eufyDevice.hasProperty('enabled')) {
        this.platform.log.debug(this.accessory.displayName, 'has a isEnabled, so append switchEnabledService characteristic to him.');

        const switchEnabledService =
          this.accessory.getService('Enabled') ||
          this.accessory.addService(this.platform.Service.Switch, 'Enabled', 'enabled');

        switchEnabledService.setCharacteristic(
          this.platform.Characteristic.Name,
          accessory.displayName + ' Enabled',
        );

        switchEnabledService.getCharacteristic(this.characteristic.On)
          .onGet(this.handleEnableGet.bind(this))
          .onSet(this.handleEnableSet.bind(this));

      } else {
        // eslint-disable-next-line max-len
        this.platform.log.debug(this.accessory.displayName, 'Looks like not compatible with isEnabled or this has been disabled within configuration');
      }
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach switchEnabledService.', Error);
    }

    try {
      this.platform.log.debug(this.accessory.displayName, 'motionButton config:', this.cameraConfig.motionButton);
      if ((this.cameraConfig.enableCamera || (typeof this.eufyDevice.isDoorbell === 'function' && this.eufyDevice.isDoorbell()))
        && this.cameraConfig.motionButton
        && this.eufyDevice.hasProperty('motionDetection')) {
        // eslint-disable-next-line max-len
        this.platform.log.debug(this.accessory.displayName, 'has a isMotionDetectionEnabled, so append switchMotionService characteristic to him.');

        const switchMotionService =
          this.accessory.getService('Motion') ||
          this.accessory.addService(this.platform.Service.Switch, 'Motion', 'motion');

        switchMotionService.setCharacteristic(
          this.platform.Characteristic.Name,
          accessory.displayName + ' Motion',
        );

        switchMotionService.getCharacteristic(this.characteristic.On)
          .onGet(this.handleMotionOnGet.bind(this))
          .onSet(this.handleMotionOnSet.bind(this));

      } else {
        // eslint-disable-next-line max-len
        this.platform.log.debug(this.accessory.displayName, 'Looks like not compatible with isMotionDetectionEnabled or this has been disabled within configuration');
      }
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach switchMotionService.', Error);
    }

    try {
      if (this.eufyDevice.hasProperty('light') && (typeof this.eufyDevice.isFloodLight === 'function' && this.eufyDevice.isFloodLight())) {
        this.platform.log.debug(this.accessory.displayName, 'has a DeviceLight, so append switchLightService characteristic to him.');

        const switchLightService =
          this.accessory.getService('Light') ||
          this.accessory.addService(this.platform.Service.Switch, 'Light', 'light');

        switchLightService.setCharacteristic(
          this.platform.Characteristic.Name,
          accessory.displayName + ' Light',
        );

        switchLightService.getCharacteristic(this.characteristic.On)
          .onGet(this.handleLightOnGet.bind(this))
          .onSet(this.handleLightOnSet.bind(this));

      } else {
        this.platform.log.debug(this.accessory.displayName, 'Looks like not compatible with DeviceLight');
      }
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach switchLightService.', Error);
    }
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
    config.useEnhancedSnapshotBehaviour = config.useEnhancedSnapshotBehaviour ??= true;
    config.delayCameraSnapshot = config.delayCameraSnapshot ??= false;

    if (!config.snapshotHandlingMethod) {
      config.snapshotHandlingMethod = (config.forcerefreshsnap) ? 1 : 3;
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
      accessory.displayName,
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
  handleHomeKitCameraOperatingModeIndicatorSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'SET HomeKitCameraOperatingModeIndicator:', value);
    const station = this.platform.getStationById(this.eufyDevice.getStationSerial());
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
  handleHomeKitNightVisionSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'SET handleHomeKitNightVisionSet:', value);
    const station = this.platform.getStationById(this.eufyDevice.getStationSerial());
    station.setNightVision(this.eufyDevice, value as number);
    this.CameraService.getCharacteristic(this.characteristic.NightVision).updateValue(value as boolean);
  }

  private motionFunction(
    accessory: PlatformAccessory,
  ): Service {
    const service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    service.setCharacteristic(
      this.characteristic.Name,
      accessory.displayName,
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

  async handleEnableGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = this.eufyDevice.getPropertyValue(PropertyName.DeviceEnabled);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceEnabled:', currentValue);
      return currentValue as boolean;
    } catch {
      this.platform.log.debug(this.accessory.displayName, 'handleEnableGet', 'Wrong return value');
      return false;
    }
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

  async handleEnableSet(value: CharacteristicValue) {
    this.platform.log.debug(this.accessory.displayName, 'SET DeviceEnabled:', value);
    const station = this.platform.getStationById(this.eufyDevice.getStationSerial());
    station.enableDevice(this.eufyDevice, value as boolean);
    this.CameraService.getCharacteristic(this.characteristic.ManuallyDisabled).updateValue(!value as boolean);
  }

  async handleMotionOnGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = await this.eufyDevice.getPropertyValue(PropertyName.DeviceMotionDetection);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceMotionDetection:', currentValue);
      return currentValue as boolean;
    } catch {
      this.platform.log.debug(this.accessory.displayName, 'handleMotionOnGet', 'Wrong return value');
      return false;
    }
  }

  async handleMotionOnSet(value: CharacteristicValue) {
    this.platform.log.debug(this.accessory.displayName, 'SET DeviceMotionDetection:', value);
    const station = this.platform.getStationById(this.eufyDevice.getStationSerial());
    station.setMotionDetection(this.eufyDevice, value as boolean);
  }

  async handleLightOnGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = await this.eufyDevice.getPropertyValue(PropertyName.DeviceLight);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceLight:', currentValue);
      return currentValue as boolean;
    } catch {
      this.platform.log.debug(this.accessory.displayName, 'handleLightOnGet', 'Wrong return value');
      return false;
    }
  }

  async handleLightOnSet(value: CharacteristicValue) {
    this.platform.log.debug(this.accessory.displayName, 'SET DeviceLight:', value);
    const station = this.platform.getStationById(this.eufyDevice.getStationSerial());
    station.switchLight(this.eufyDevice, value as boolean);
  }
}
