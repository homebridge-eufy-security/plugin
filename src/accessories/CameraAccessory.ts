import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Camera, Device, DeviceType, PropertyValue } from 'eufy-security-client';
import { EufyCameraStreamingDelegate } from './streamingDelegate';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class CameraAccessory extends DeviceAccessory {

  protected service: Service;
  protected Camera: Camera;
  protected MotionService: Service;
  protected motion_triggered: boolean;


  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: Camera,
  ) {
    super(platform, accessory, eufyDevice);
    this.Camera = eufyDevice;

    this.service = {} as Service;
    this.MotionService = {} as Service;

    this.platform.log.debug(this.accessory.displayName, 'Constructed Camera');

    this.motion_triggered = false;

    try {
      if (this.platform.config.enableCamera || (typeof this.Camera.isDoorbell === 'function' && this.Camera.isDoorbell())) {
        this.platform.log.debug(this.accessory.displayName, 'has a camera');
        try {
          this.service = this.cameraFunction(accessory);
          this.MotionService = this.motionFunction(accessory);

          //video stream (work in progress)

          const delegate = new EufyCameraStreamingDelegate(this.platform, this.Camera);
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
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'has a motion sensor.', Error);
    }

    try {
      if (typeof this.Camera.hasBattery === 'function' && this.Camera.hasBattery()) {
        this.platform.log.debug(this.accessory.displayName, 'has a battery, so append Battery characteristic to him.');

        const batteryService =
          this.accessory.getService(this.platform.Service.Battery) ||
          this.accessory.addService(this.platform.Service.Battery);

        batteryService.setCharacteristic(
          this.platform.Characteristic.Name,
          accessory.displayName,
        );

        // create handlers for required characteristics of Battery service
        batteryService
          .getCharacteristic(this.characteristic.BatteryLevel)
          .onGet(this.handleBatteryLevelGet.bind(this));
      } else {
        this.platform.log.warn(this.accessory.displayName, 'Looks like not compatible with hasBattery');
      }
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach a battery.', Error);
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

    // create handlers for required characteristics of Motion Sensor
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

  async getCurrentBatteryLevel() {
    const batteryLevel = this.Camera.getBatteryValue();
    return batteryLevel.value as number;
  }

  /**
   * Handle requests to get the current value of the "Status Low Battery" characteristic
   */
  async handleBatteryLevelGet(): Promise<CharacteristicValue> {
    const currentValue = await this.getCurrentBatteryLevel();
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET BatteryLevel:', currentValue);
    return currentValue as number;
  }

  async isMotionDetected() {
    const isMotionDetected = this.Camera.isMotionDetected();
    return isMotionDetected as boolean;
  }

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleMotionDetectedGet() {
    const currentValue = await this.isMotionDetected();
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET MotionDetected:', currentValue);
    return currentValue as boolean;
  }

  private onDeviceMotionDetectedPushNotification(
    device: Device,
    motion: boolean,
  ): void {
    this.platform.log.debug(this.accessory.displayName, 'Handle Camera motion:  -- ', motion);
    this.motion_triggered = (this.motion_triggered) ? false : true;
    this.platform.log.debug(this.accessory.displayName, 'Handle Camera motion:  -- ', this.motion_triggered);
    this.service
      .getCharacteristic(this.characteristic.MotionDetected)
      .updateValue(this.motion_triggered);
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  async handleEnableGet(): Promise<CharacteristicValue> {
    const currentValue = this.Camera.isEnabled().value;
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET Enable:', currentValue);
    return currentValue as boolean;
  }

  /**
       * Handle requests to set the "On" characteristic
       */
  async handleEnableSet(value: CharacteristicValue) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered SET Enable:', value);
    const station = this.platform.getStationById(this.Camera.getStationSerial());
    station.enableDevice(this.Camera, value as boolean);
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  async handleMotionOnGet(): Promise<CharacteristicValue> {
    const currentValue = await this.Camera.isMotionDetectionEnabled().value;
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET Motion:', currentValue);
    return currentValue as boolean;
  }

  /**
         * Handle requests to set the "On" characteristic
         */
  async handleMotionOnSet(value: CharacteristicValue) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered SET Motion:', value);
    const station = this.platform.getStationById(this.Camera.getStationSerial());
    station.setMotionDetection(this.Camera, value as boolean);
  }
}
