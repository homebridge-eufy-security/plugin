import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Camera, Device, PropertyName } from 'eufy-security-client';
import { StreamingDelegate } from './streamingDelegate';

import { CameraConfig, VideoConfig } from './configTypes';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class CameraAccessory extends DeviceAccessory {

  protected service: Service;
  protected Camera: Camera;
  protected CameraService: Service;

  protected readonly cameraConfig: CameraConfig;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: Camera,
  ) {
    super(platform, accessory, eufyDevice);
    this.Camera = eufyDevice;

    this.service = {} as Service;
    this.CameraService = {} as Service;
    this.cameraConfig = {} as CameraConfig;

    this.platform.log.debug(this.accessory.displayName, 'Constructed Camera');

    if (this.platform.config.enableCamera || (typeof this.Camera.isDoorbell === 'function' && this.Camera.isDoorbell())) {
      this.platform.log.debug(this.accessory.displayName, 'has a camera');
      try {
        this.CameraService = this.cameraFunction(accessory);
        this.service = this.motionFunction(accessory);

        //video stream (work in progress)
        this.cameraConfig = {
          'name': this.Camera.getName(),
          'videoConfig': {
            'stillImageSource': '',
            'audio': true,
            'debug': false,
          } as VideoConfig,
        };

        const delegate = new StreamingDelegate(this.platform, this.Camera, this.cameraConfig, this.platform.api, this.platform.api.hap);
        accessory.configureController(delegate.controller);
      } catch (Error) {
        this.platform.log.error(this.accessory.displayName, 'raise error to check and attach livestream function.', Error);
      }
    } else {
      this.platform.log.debug(this.accessory.displayName, 'has a motion sensor.');
      try {
        this.service = this.motionFunction(accessory);
      } catch (Error) {
        this.platform.log.error(this.accessory.displayName, 'raise error to check and attach motion function.', Error);
      }
    }

    try {
      if (typeof this.Camera.isEnabled === 'function') {
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
        this.platform.log.warn(this.accessory.displayName, 'Looks like not compatible with isEnabled');
      }
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach switchEnabledService.', Error);
    }

    try {
      if (typeof this.Camera.isMotionDetectionEnabled === 'function') {
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
        this.platform.log.debug(this.accessory.displayName, 'Looks like not compatible with isMotionDetectionEnabled');
      }
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach switchMotionService.', Error);
    }
  }

  handleEventSnapshotsActiveGet(): Promise<CharacteristicValue> {
    const currentValue = this.characteristic.EventSnapshotsActive.DISABLE;
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET EventSnapshotsActive:', currentValue);
    return currentValue;
  }

  /**
   * Handle requests to set the "Event Snapshots Active" characteristic
   */
  handleEventSnapshotsActiveSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered SET EventSnapshotsActive:', value);
  }

  /**
   * Handle requests to get the current value of the "HomeKit Camera Active" characteristic
   */
  handleHomeKitCameraActiveGet(): Promise<CharacteristicValue> {
    const currentValue = this.characteristic.HomeKitCameraActive.OFF;
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET HomeKitCameraActive:', currentValue);
    return currentValue;
  }

  /**
   * Handle requests to set the "HomeKit Camera Active" characteristic
   */
  handleHomeKitCameraActiveSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered SET HomeKitCameraActive:', value);
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

    return service as Service;
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

    this.Camera.on('motion detected', (device: Device, motion: boolean) =>
      this.onDeviceMotionDetectedPushNotification(device, motion),
    );

    this.Camera.on('person detected', (device: Device, motion: boolean) =>
      this.onDeviceMotionDetectedPushNotification(device, motion),
    );

    this.Camera.on('pet detected', (device: Device, motion: boolean) =>
      this.onDeviceMotionDetectedPushNotification(device, motion),
    );

    return service as Service;
  }

  async handleMotionDetectedGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = this.Camera.getPropertyValue(PropertyName.DeviceMotionDetected);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceMotionDetected:', currentValue);
      return currentValue.value as boolean;
    } catch {
      this.platform.log.error(this.accessory.displayName, 'handleMotionDetectedGet', 'Wrong return value');
      return false;
    }
  }

  private onDeviceMotionDetectedPushNotification(
    device: Device,
    motion: boolean,
  ): void {
    this.platform.log.debug(this.accessory.displayName, 'ON DeviceMotionDetected:', motion);
    this.service
      .getCharacteristic(this.characteristic.MotionDetected)
      .updateValue(motion);
  }

  async handleEnableGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = this.Camera.getPropertyValue(PropertyName.DeviceEnabled);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceEnabled:', currentValue);
      return currentValue.value as boolean;
    } catch {
      this.platform.log.error(this.accessory.displayName, 'handleEnableGet', 'Wrong return value');
      return false;
    }
  }

  async handleEnableSet(value: CharacteristicValue) {
    this.platform.log.debug(this.accessory.displayName, 'SET DeviceEnabled:', value);
    const station = this.platform.getStationById(this.Camera.getStationSerial());
    station.enableDevice(this.Camera, value as boolean);
  }

  async handleMotionOnGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = await this.Camera.getPropertyValue(PropertyName.DeviceMotionDetection);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceMotionDetection:', currentValue);
      return currentValue.value as boolean;
    } catch {
      this.platform.log.error(this.accessory.displayName, 'handleMotionOnGet', 'Wrong return value');
      return false;
    }
  }

  async handleMotionOnSet(value: CharacteristicValue) {
    this.platform.log.debug(this.accessory.displayName, 'SET DeviceMotionDetection:', value);
    const station = this.platform.getStationById(this.Camera.getStationSerial());
    station.setMotionDetection(this.Camera, value as boolean);
  }
}
