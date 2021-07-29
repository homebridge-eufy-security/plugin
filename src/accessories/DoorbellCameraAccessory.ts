import { Service, PlatformAccessory } from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { DoorbellCamera, Device, DeviceType, PropertyValue } from 'eufy-security-client';
import { EufyCameraStreamingDelegate } from './streamingDelegate';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DoorbellCameraAccessory extends DeviceAccessory {

  protected service: Service;
  protected DoorbellCamera: DoorbellCamera;

  private doorbellService: Service;
  private MotionService: Service;
  private motion_triggered: boolean;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: DoorbellCamera,
  ) {
    super(platform, accessory, eufyDevice);
    this.DoorbellCamera = eufyDevice;

    this.platform.log.debug(this.accessory.displayName, 'Constructed Doorbell');

    this.motion_triggered = false;

    this.service =
      this.accessory.getService(this.platform.Service.CameraOperatingMode) ||
      this.accessory.addService(this.platform.Service.CameraOperatingMode);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    this.service
      .getCharacteristic(this.platform.Characteristic.EventSnapshotsActive)
      .on('get', this.handleEventSnapshotsActiveGet.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.EventSnapshotsActive)
      .on('set', this.handleEventSnapshotsActiveSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.HomeKitCameraActive)
      .on('get', this.handleHomeKitCameraActiveGet.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.HomeKitCameraActive)
      .on('set', this.handleHomeKitCameraActiveSet.bind(this));

    this.doorbellService =
      this.accessory.getService(this.platform.Service.Doorbell) ||
      this.accessory.addService(this.platform.Service.Doorbell);

    // set the Battery service characteristics
    this.doorbellService.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics of Battery service
    this.doorbellService
      .getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .on('get', this.handleProgrammableSwitchEventGet.bind(this));
  
    this.DoorbellCamera.on('rings', (device: Device, state: boolean) =>
      this.onDeviceRingsPushNotification(),
    );

    this.MotionService =
    this.accessory.getService(this.platform.Service.MotionSensor) ||
    this.accessory.addService(this.platform.Service.MotionSensor);

    // set the Battery service characteristics
    this.MotionService.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics of Battery service
    this.MotionService
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .on('get', this.handleMotionDetectedGet.bind(this));

    this.DoorbellCamera.on('motion detected', (device: Device, motion: boolean) =>
      this.onDeviceMotionDetectedPushNotification(device, motion),
    );

    this.DoorbellCamera.on('person detected', (device: Device, motion: boolean) =>
      this.onDeviceMotionDetectedPushNotification(device, motion),
    );

    this.DoorbellCamera.on('pet detected', (device: Device, motion: boolean) =>
      this.onDeviceMotionDetectedPushNotification(device, motion),
    );

    if(this.DoorbellCamera.hasBattery && this.DoorbellCamera.hasBattery()) {
      this.platform.log.debug(this.accessory.displayName, 'has a battery, so append batteryService characteristic to him.');

      const batteryService =
      this.accessory.getService(this.platform.Service.BatteryService) ||
      this.accessory.addService(this.platform.Service.BatteryService);

      // set the Battery service characteristics
      batteryService.setCharacteristic(
        this.platform.Characteristic.Name,
        accessory.displayName,
      );

      // create handlers for required characteristics of Battery service
      batteryService
        .getCharacteristic(this.platform.Characteristic.BatteryLevel)
        .on('get', this.handleBatteryLevelGet.bind(this));
    }

    this.doorbellService.setPrimaryService(true);

    //video stream (work in progress)
  
    const delegate = new EufyCameraStreamingDelegate(this.platform, this.DoorbellCamera);
    accessory.configureController(delegate.controller);

  }

  handleEventSnapshotsActiveGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET EventSnapshotsActive');

    // set this to a valid value for EventSnapshotsActive
    const currentValue = this.platform.Characteristic.EventSnapshotsActive.DISABLE;

    callback(null, currentValue);
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
  handleHomeKitCameraActiveGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET HomeKitCameraActive');

    // set this to a valid value for HomeKitCameraActive
    const currentValue = this.platform.Characteristic.HomeKitCameraActive.OFF;

    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "HomeKit Camera Active" characteristic
   */
  handleHomeKitCameraActiveSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered SET HomeKitCameraActive:', value);
  }

  /**
   * Handle requests to get the current value of the "Status Low Battery" characteristic
   */
  async handleBatteryLevelGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET BatteryLevel');

    // set this to a valid value for SecuritySystemCurrentState
    const currentValue = await this.getCurrentBatteryLevel();
    this.platform.log.debug(this.accessory.displayName, 'Handle Current battery level:  -- ', currentValue);

    callback(null, currentValue);
  }

  async getCurrentBatteryLevel() {
    const batteryLevel = this.DoorbellCamera.getBatteryValue();
    return batteryLevel.value as number;
  }

  async handleProgrammableSwitchEventGet(callback) {
    callback(null, null);
  }

  private onDeviceRingsPushNotification(): void {
    this.platform.log.debug(this.accessory.displayName, 'DoorBell ringing');
    this.doorbellService
      .getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .updateValue(this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
  }

  async isMotionDetected() {
    const isMotionDetected = this.DoorbellCamera.isMotionDetected();
    return isMotionDetected as boolean;
  }

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleMotionDetectedGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET MotionDetected');

    const currentValue = await this.isMotionDetected();
    this.platform.log.debug(this.accessory.displayName, 'Handle DoorBell motion:  -- ', currentValue);

    callback(null, currentValue as boolean);
  }

  private onDeviceMotionDetectedPushNotification(
    device: Device,
    motion: boolean,
  ): void {
    this.platform.log.debug(this.accessory.displayName, 'Handle DoorBell motion:  -- ', motion);
    this.motion_triggered = (this.motion_triggered) ? false : true;
    this.platform.log.debug(this.accessory.displayName, 'Handle DoorBell motion:  -- ', this.motion_triggered);
    this.MotionService
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .updateValue(this.motion_triggered);
  }

}
