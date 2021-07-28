import { Service, PlatformAccessory } from 'homebridge';

import { EufySecurityPlatform } from '../platform';

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
export class CameraAccessory {
  private service: Service;
  private MotionService: Service;
  private switchEnabledService: Service;
  private switchMotionService: Service;
  private motion_triggered: boolean;

  constructor(
    private readonly platform: EufySecurityPlatform,
    private readonly accessory: PlatformAccessory,
    private eufyDevice: Camera,
  ) {

    this.service = {} as Service;
    this.MotionService = {} as Service;
    this.switchEnabledService = {} as Service;
    this.switchMotionService = {} as Service;

    this.platform.log.debug(this.accessory.displayName, 'Constructed Camera');

    this.motion_triggered = false;

    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Eufy')
      .setCharacteristic(
        this.platform.Characteristic.Model,
        DeviceType[eufyDevice.getDeviceType()],
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        eufyDevice.getSerial(),
      )
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        eufyDevice.getSoftwareVersion(),
      )
      .setCharacteristic(
        this.platform.Characteristic.HardwareRevision,
        eufyDevice.getHardwareVersion(),
      );



    if(this.platform.config.enableCamera) {
      this.platform.log.info(this.accessory.displayName, 'has a camera');
      this.service = this.cameraFunction(accessory);
      this.MotionService = this.motionFunction(accessory);

      //video stream (work in progress)
    
      const delegate = new EufyCameraStreamingDelegate(this.platform, this.eufyDevice);
      accessory.configureController(delegate.controller);

    } else {
      this.platform.log.info(this.accessory.displayName, 'has a motion sensor.');
      this.service = this.motionFunction(accessory);
    }

    if(this.eufyDevice.hasBattery && this.eufyDevice.hasBattery()) {
      this.platform.log.debug(this.accessory.displayName, 'has a battery, so append batteryService characteristic to him.');

      const batteryService =
      this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery);

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

    if(this.eufyDevice.isEnabled && !this.eufyDevice.isEnabled()) {

      // create a new Switch service
      this.switchEnabledService = 
        this.accessory.getService('Enabled') ||
        this.accessory.addService(this.platform.Service.Switch, 'Enabled', 'enabled');
      
      // create handlers for required characteristics
      this.switchEnabledService.getCharacteristic(this.platform.Characteristic.On)
        .on('get', this.handleOnGet.bind(this))
        .on('set', this.handleOnSet.bind(this));

    }

    if(this.eufyDevice.isIndoorCamera && !this.eufyDevice.isIndoorCamera()) {

      this.switchMotionService =
        this.accessory.getService('Motion') ||
        this.accessory.addService(this.platform.Service.Switch, 'Motion', 'motion');

      // create handlers for required characteristics
      this.switchMotionService.getCharacteristic(this.platform.Characteristic.On)
        .on('get', this.handleMotionOnGet.bind(this))
        .on('set', this.handleMotionOnSet.bind(this));
      
    }

    if(this.platform.config.enableDetailedLogging) {
      this.eufyDevice.on('raw property changed', (device: Device, type: number, value: string, modified: number) =>
        this.handleRawPropertyChange(device, type, value, modified),
      );
      this.eufyDevice.on('property changed', (device: Device, name: string, value: PropertyValue) =>
        this.handlePropertyChange(device, name, value),
      );
    }
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

  private cameraFunction(
      accessory: PlatformAccessory,
  ): Service {
    const service =
      this.accessory.getService(this.platform.Service.CameraOperatingMode) ||
      this.accessory.addService(this.platform.Service.CameraOperatingMode);

    service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    service
      .getCharacteristic(this.platform.Characteristic.EventSnapshotsActive)
      .on('get', this.handleEventSnapshotsActiveGet.bind(this));
    service
      .getCharacteristic(this.platform.Characteristic.EventSnapshotsActive)
      .on('set', this.handleEventSnapshotsActiveSet.bind(this));

    service
      .getCharacteristic(this.platform.Characteristic.HomeKitCameraActive)
      .on('get', this.handleHomeKitCameraActiveGet.bind(this));
    service
      .getCharacteristic(this.platform.Characteristic.HomeKitCameraActive)
      .on('set', this.handleHomeKitCameraActiveSet.bind(this));

    return service as Service;
  }

  private motionFunction(
    accessory: PlatformAccessory,
  ): Service {
    const service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics of Motion Sensor
    service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .on('get', this.handleMotionDetectedGet.bind(this));

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


  private handleRawPropertyChange(
    device: Device, 
    type: number, 
    value: string, 
    modified: number,
  ): void {
    this.platform.log.info(
      'Handle Camera Raw Property Changes:  -- ',
      type, 
      value, 
      modified,
    );
  }

  private handlePropertyChange(
    device: Device, 
    name: string, 
    value: PropertyValue,
  ): void {
    this.platform.log.info(
      'Handle Camera Property Changes:  -- ',
      name, 
      value,
    );
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
    const batteryLevel = this.eufyDevice.getBatteryValue();

    return batteryLevel.value as number;
  }

  async isMotionDetected() {
    const isMotionDetected = this.eufyDevice.isMotionDetected();
    return isMotionDetected as boolean;
  }

  /**
   * Handle requests to get the current value of the 'Security System Current State' characteristic
   */
  async handleMotionDetectedGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET MotionDetected');

    const currentValue = await this.isMotionDetected();
    this.platform.log.debug(this.accessory.displayName, 'Handle Camera Motion:  -- ', currentValue);

    callback(null, currentValue as boolean);
  }

  private onDeviceMotionDetectedPushNotification(
    device: Device,
    motion: boolean,
  ): void {
    this.platform.log.debug(this.accessory.displayName, 'Handle DoorBell motion:  -- ', motion);
    this.motion_triggered = (this.motion_triggered) ? false : true;
    this.platform.log.debug(this.accessory.displayName, 'Handle DoorBell motion:  -- ', this.motion_triggered);
    this.service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .updateValue(this.motion_triggered);
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  async handleOnGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET On');
    
    const currentValue = this.eufyDevice.isEnabled().value;
    
    this.platform.log.debug(this.accessory.displayName, 'Handle Switch:  -- ', currentValue);

    callback(null, currentValue);
  }
    
  /**
       * Handle requests to set the "On" characteristic
       */
  async handleOnSet(value, callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered SET On: ' + value);

    const station = this.platform.getStationById(this.eufyDevice.getStationSerial());
        
    station.enableDevice(this.eufyDevice, value);

    callback(null);
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  async handleMotionOnGet(callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered GET On');

    const currentValue = await this.eufyDevice.isMotionDetectionEnabled().value;
      
    this.platform.log.debug(this.accessory.displayName, 'Handle Switch:  -- ', currentValue);
  
    callback(null, currentValue);
  }
      
  /**
         * Handle requests to set the "On" characteristic
         */
  async handleMotionOnSet(value, callback) {
    this.platform.log.debug(this.accessory.displayName, 'Triggered SET On: ' + value);
  
    const station = this.platform.getStationById(this.eufyDevice.getStationSerial());
          
    station.setMotionDetection(this.eufyDevice, value);

    callback(null);
  }
}
