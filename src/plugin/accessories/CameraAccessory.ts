/* eslint-disable max-len */
import {
  PlatformAccessory,
  Characteristic,
  CharacteristicValue,
  Resolution,
} from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Camera, Device, DeviceEvents, PropertyName, CommandName } from 'eufy-security-client';

import { StreamingDelegate } from '../utils/stream2';

import { CameraConfig, DEFAULT_CAMERACONFIG_VALUES } from '../utils/configTypes';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class CameraAccessory extends DeviceAccessory {

  // Define the object variable to hold the boolean and timestamp
  protected cameraStatus: { isEnabled: boolean; timestamp: number };
  private notificationTimeout: NodeJS.Timeout | null = null;

  public readonly cameraConfig: CameraConfig;

  public stream?: StreamingDelegate;

  public hardwareTranscoding: boolean = true;
  public hardwareDecoding: boolean = true;
  public timeshift: boolean = false;
  public hksvRecording: boolean = true;
  public HksvErrors: number = 0;

  public isOnline: boolean = true;

  // List of event types
  private eventTypesToHandle: (keyof DeviceEvents)[] = [
    'motion detected',
    'person detected',
    'pet detected',
    'vehicle detected',
    'sound detected',
    'crying detected',
    'dog detected',
    'stranger person detected',
  ];

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: Camera,
  ) {
    super(platform, accessory, device);

    this.cameraConfig = {} as CameraConfig;

    this.cameraStatus = { isEnabled: false, timestamp: 0 }; // Initialize the cameraStatus object

    this.platform.log.debug(`${this.accessory.displayName} Constructed Camera`);

    this.cameraConfig = this.getCameraConfig();

    if (this.cameraConfig.enableCamera || this.device.isDoorbell()) {
      this.platform.log.debug(`${this.accessory.displayName} has a camera`);
      this.setupCamera();
      this.setupChimeButton();
      this.initSensorService(this.platform.Service.Battery);
    } else {
      this.platform.log.debug(`${this.accessory.displayName} has a motion sensor`);
      this.setupMotionFunction();
      this.initSensorService(this.platform.Service.MotionSensor);
    }

    this.setupEnableButton();
    this.setupMotionButton();
    this.setupLightButton();

    this.pruneUnusedServices();
  }

  private setupCamera() {
    try {
      this.cameraFunction();
    } catch (error) {
      this.platform.log.error(`${this.accessory.displayName} while happending CameraFunction ${error}`);
    }

    try {
      this.setupRTSP()
        .then(() => {
          this.platform.log.info(`${this.accessory.displayName} RTSP url: ${this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl)}`);
        })
        .catch((error) => {
          // Handle any errors that occur during the promise chain
          this.platform.log.error('Error in setupRTSP:', error);
        });

      this.platform.log.debug(`${this.accessory.displayName} StreamingDelegate`);
      this.stream = new StreamingDelegate(this);

      this.accessory.configureController(this.stream.getController());

    } catch (error) {
      this.platform.log.error(`${this.accessory.displayName} while happending Delegate ${error}`);
    }
  }

  private setupRTSP() {
    return new Promise<void>((resolve) => {
      if (this.device.hasProperty(PropertyName.DeviceRTSPStream)) {
        if (!this.device.getPropertyValue(PropertyName.DeviceRTSPStream)) {
          this.setPropertyValue(PropertyName.DeviceRTSPStream, true)
            .then(() => {
              this.platform.log.info(`${this.accessory.displayName} enabling RTSP`);
              resolve(); // Resolve the promise after setting the RTSP property
            })
            .catch((error) => {
              // Handle any errors that occur during setting the property
              this.platform.log.error('Error setting RTSP property:', error);
              resolve(); // Resolve the promise even if there's an error
            });
        } else {
          this.platform.log.info(`${this.accessory.displayName} RTSP enabled`);
          resolve(); // Resolve the promise if RTSP is already enabled
        }
      } else {
        resolve(); // Resolve the promise if the property doesn't exist
      }
    });
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

  protected setupSwitchService(
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
      getValue: (data, characteristic) => this.getCameraPropertyValue(characteristic, propertyName),
      setValue: (value, characteristic) => this.setCameraPropertyValue(characteristic, propertyName, value),
    });
  }

  private async setupEnableButton() {
    this.setupButtonService('Enabled', this.cameraConfig.enableButton, PropertyName.DeviceEnabled, 'switch');
  }

  private async setupMotionButton() {
    this.setupButtonService('Motion', this.cameraConfig.motionButton, PropertyName.DeviceMotionDetection, 'switch');
  }

  private async setupLightButton() {
    this.setupButtonService('Light', this.cameraConfig.lightButton, PropertyName.DeviceLight, 'lightbulb');
  }

  private async setupChimeButton() {
    this.setupButtonService('IndoorChime', this.cameraConfig.indoorChimeButton, PropertyName.DeviceChimeIndoor, 'switch');
  }

  /**
   * Get the configuration for a camera device.
   * 
   * - Combines default settings with those from the platform config.
   * - Validates certain settings like talkback capability.
   * 
   * @returns {CameraConfig} The finalized camera configuration.
   */
  private getCameraConfig(): CameraConfig {
    // Find the specific camera config from the platform based on its serial number
    const foundConfig = this.platform.config.cameras?.find(
      e => e.serialNumber === this.device.getSerial(),
    ) ?? {};

    // Combine default and specific configurations
    const config: Partial<CameraConfig> = {
      ...DEFAULT_CAMERACONFIG_VALUES,
      ...foundConfig,
      name: this.accessory.displayName,
    };

    // Set snapshot handling method based on `forcerefreshsnap` value
    config.snapshotHandlingMethod = config.snapshotHandlingMethod ?? (config.forcerefreshsnap ? 1 : 3);

    // Initialize videoConfig if it's undefined
    if (!config.videoConfig) {
      config.videoConfig = {};
    }

    config.videoConfig!.debug = config.videoConfig?.debug ?? false;

    // Validate talkback setting
    if (config.talkback && !this.device.hasCommand(CommandName.DeviceStartTalkback)) {
      this.platform.log.warn(this.accessory.displayName, 'Talkback for this device is not supported!');
      config.talkback = false;
    }

    // Validate talkback with rtsp setting
    if (config.talkback && config.rtsp) {
      this.platform.log.warn(this.accessory.displayName, 'Talkback cannot be used with rtsp option. Ignoring talkback setting.');
      config.talkback = false;
    }

    this.platform.log.debug(`${this.accessory.displayName} config is: ${JSON.stringify(config)}`);

    return config as CameraConfig;
  }

  private cameraFunction() {

    if (!this.cameraConfig.hsv) {
      this.registerCharacteristic({
        serviceType: this.platform.Service.CameraOperatingMode,
        characteristicType: this.platform.Characteristic.EventSnapshotsActive,
        getValue: (data) => this.handleDummyEventGet('EventSnapshotsActive'),
        setValue: (value) => this.handleDummyEventSet('EventSnapshotsActive', value),
      });

      this.registerCharacteristic({
        serviceType: this.platform.Service.CameraOperatingMode,
        characteristicType: this.platform.Characteristic.HomeKitCameraActive,
        getValue: (data, characteristic) =>
          this.getCameraPropertyValue(characteristic, PropertyName.DeviceEnabled),
        setValue: (value, characteristic) =>
          this.setCameraPropertyValue(characteristic, PropertyName.DeviceEnabled, value),
      });

      if (this.device.hasProperty('enabled')) {
        this.registerCharacteristic({
          serviceType: this.platform.Service.CameraOperatingMode,
          characteristicType: this.platform.Characteristic.ManuallyDisabled,
          getValue: (data, characteristic) =>
            this.getCameraPropertyValue(characteristic, PropertyName.DeviceEnabled),
        });
      }

      if (this.device.hasProperty('statusLed')) {
        this.registerCharacteristic({
          serviceType: this.platform.Service.CameraOperatingMode,
          characteristicType: this.platform.Characteristic.CameraOperatingModeIndicator,
          getValue: (data, characteristic) =>
            this.getCameraPropertyValue(characteristic, PropertyName.DeviceStatusLed),
          setValue: (value, characteristic) =>
            this.setCameraPropertyValue(characteristic, PropertyName.DeviceStatusLed, value),
        });
      }

      if (this.device.hasProperty('nightvision')) {
        this.registerCharacteristic({
          serviceType: this.platform.Service.CameraOperatingMode,
          characteristicType: this.platform.Characteristic.NightVision,
          getValue: (data, characteristic) =>
            this.getCameraPropertyValue(characteristic, PropertyName.DeviceNightvision),
          setValue: (value, characteristic) =>
            this.setCameraPropertyValue(characteristic, PropertyName.DeviceNightvision, value),
        });
      }

      if (this.device.hasProperty('autoNightvision')) {
        this.registerCharacteristic({
          serviceType: this.platform.Service.CameraOperatingMode,
          characteristicType: this.platform.Characteristic.NightVision,
          getValue: (data, characteristic) =>
            this.getCameraPropertyValue(characteristic, PropertyName.DeviceAutoNightvision),
          setValue: (value, characteristic) =>
            this.setCameraPropertyValue(characteristic, PropertyName.DeviceAutoNightvision, value),
        });
      }

      this.getService(this.platform.Service.CameraOperatingMode).setPrimaryService(true);
    }

    // Fire snapshot when motion detected
    this.registerCharacteristic({
      serviceType: this.platform.Service.MotionSensor,
      characteristicType: this.platform.Characteristic.MotionDetected,
      getValue: (data) => this.device.getPropertyValue(PropertyName.DeviceMotionDetected),
      onValue: (service, characteristic) => {
        this.eventTypesToHandle.forEach(eventType => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.device.on(eventType as keyof any, (device: any, state: any) => {
            // eslint-disable-next-line max-len
            this.platform.log.info(`${this.accessory.displayName} MOTION DETECTED (${eventType})': ${state}`);
            characteristic.updateValue(state);
          });
        });
      },
    });

    // if (this.device.hasProperty('speaker')) {
    //   this.registerCharacteristic({
    //     serviceType: this.platform.Service.Speaker,
    //     characteristicType: this.platform.Characteristic.Mute,
    //     serviceSubType: 'speaker_mute',
    //     getValue: (data, characteristic) =>
    //       this.getCameraPropertyValue(characteristic, PropertyName.DeviceSpeaker),
    //     setValue: (value, characteristic) =>
    //       this.setCameraPropertyValue(characteristic, PropertyName.DeviceSpeaker, value),
    //   });
    // }

    // if (this.device.hasProperty('speakerVolume')) {
    //   this.registerCharacteristic({
    //     serviceType: this.platform.Service.Speaker,
    //     characteristicType: this.platform.Characteristic.Volume,
    //     serviceSubType: 'speaker_volume',
    //     getValue: (data, characteristic) =>
    //       this.getCameraPropertyValue(characteristic, PropertyName.DeviceSpeakerVolume),
    //     setValue: (value, characteristic) =>
    //       this.setCameraPropertyValue(characteristic, PropertyName.DeviceSpeakerVolume, value),
    //   });
    // }

    // if (this.device.hasProperty('microphone')) {
    //   this.registerCharacteristic({
    //     serviceType: this.platform.Service.Microphone,
    //     characteristicType: this.platform.Characteristic.Mute,
    //     serviceSubType: 'mic_mute',
    //     getValue: (data, characteristic) =>
    //       this.getCameraPropertyValue(characteristic, PropertyName.DeviceMicrophone),
    //     setValue: (value, characteristic) =>
    //       this.setCameraPropertyValue(characteristic, PropertyName.DeviceMicrophone, value),
    //   });
    // }

    if (this.device.isDoorbell()) {
      this.registerCharacteristic({
        serviceType: this.platform.Service.Doorbell,
        characteristicType: this.platform.Characteristic.ProgrammableSwitchEvent,
        getValue: () => this.handleDummyEventGet('EventSnapshotsActive'),
        onValue: (service, characteristic) => {
          this.device.on('rings', (device: Device, state: boolean) =>
            this.onDeviceRingsPushNotification(characteristic),
          );
        },
      });
    }

  }

  // This private function sets up the motion sensor characteristics for the accessory.
  private setupMotionFunction() {
    // Register the motion sensor characteristic for detecting motion.
    this.registerCharacteristic({
      serviceType: this.platform.Service.MotionSensor,
      characteristicType: this.platform.Characteristic.MotionDetected,
      getValue: (data) => this.device.getPropertyValue(PropertyName.DeviceMotionDetected),
      onMultipleValue: this.eventTypesToHandle,
    });

    // If the camera is disabled, flag the motion sensor as tampered.
    // This is done because the motion sensor won't work until the camera is enabled again.
    this.registerCharacteristic({
      serviceType: this.platform.Service.MotionSensor,
      characteristicType: this.platform.Characteristic.StatusTampered,
      getValue: (data) => {
        const tampered = this.device.getPropertyValue(PropertyName.DeviceEnabled);
        this.platform.log.debug(`${this.accessory.displayName} TAMPERED? ${!tampered}`);
        return tampered
          ? this.platform.Characteristic.StatusTampered.NOT_TAMPERED
          : this.platform.Characteristic.StatusTampered.TAMPERED;
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected getCameraPropertyValue(characteristic: any, propertyName: PropertyName): CharacteristicValue {
    try {
      let value = this.device.getPropertyValue(propertyName);

      this.platform.log.debug(`${this.accessory.displayName} GET '${characteristic.displayName}' ${propertyName}: ${value}`);

      if (propertyName === PropertyName.DeviceNightvision) {
        return value === 1;
      }

      // Override for PropertyName.DeviceEnabled when enabled button is fired and 
      if (
        propertyName === PropertyName.DeviceEnabled &&
        Date.now() - this.cameraStatus.timestamp <= 60000
      ) {
        // eslint-disable-next-line max-len
        this.platform.log.debug(`${this.accessory.displayName} CACHED for (1 min) '${characteristic.displayName}' ${propertyName}: ${this.cameraStatus.isEnabled}`);
        value = this.cameraStatus.isEnabled;
      }

      if (characteristic.displayName === 'Manually Disabled') {
        value = !value;
        this.platform.log.debug(`${this.accessory.displayName} INVERSED '${characteristic.displayName}' ${propertyName}: ${value}`);
      }

      if (value === undefined) {
        return false;
      }

      return value as CharacteristicValue;
    } catch (error) {
      this.platform.log.debug(`${this.accessory.displayName} Error getting '${characteristic.displayName}' ${propertyName}: ${error}`);
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async setCameraPropertyValue(characteristic: any, propertyName: PropertyName, value: CharacteristicValue) {
    try {
      this.platform.log.debug(`${this.accessory.displayName} SET '${characteristic.displayName}' ${propertyName}: ${value}`);
      await this.setPropertyValue(propertyName, value);

      if (
        propertyName === PropertyName.DeviceEnabled &&
        characteristic.displayName === 'On'
      ) {
        characteristic.updateValue(value);

        this.cameraStatus = { isEnabled: value as boolean, timestamp: Date.now() };
        characteristic = this.getService(this.platform.Service.CameraOperatingMode)
          .getCharacteristic(this.platform.Characteristic.ManuallyDisabled);

        this.platform.log.debug(`${this.accessory.displayName} INVERSED '${characteristic.displayName}' ${propertyName}: ${!value}`);
        value = !value as boolean;
      }

      characteristic.updateValue(value);
    } catch (error) {
      this.platform.log.debug(`${this.accessory.displayName} Error setting '${characteristic.displayName}' ${propertyName}: ${error}`);
    }
  }

  /**
   * Handle push notifications for a doorbell device.
   * Mute subsequent notifications within a timeout period.
   * @param characteristic - The Characteristic to update for HomeKit.
   */
  private onDeviceRingsPushNotification(characteristic: Characteristic): void {
    if (!this.notificationTimeout) {
      this.platform.log.debug(`${this.accessory.displayName} DoorBell ringing`);
      characteristic.updateValue(this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
      // Set a new timeout for muting subsequent notifications
      this.notificationTimeout = setTimeout(() => { }, 3000);
    }
  }
}
