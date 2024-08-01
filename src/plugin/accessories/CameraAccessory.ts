/* eslint-disable max-len */
import {
  PlatformAccessory,
  Characteristic,
  CharacteristicValue,
  Resolution,
  CameraControllerOptions,
  SRTPCryptoSuites,
  H264Profile,
  H264Level,
  EventTriggerOption,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  MediaContainerType,
  AudioRecordingCodecType,
  AudioRecordingSamplerate,
} from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Camera, DeviceEvents, PropertyName, CommandName, StreamMetadata, PropertyValue } from 'eufy-security-client';

import { CameraConfig, DEFAULT_CAMERACONFIG_VALUES } from '../utils/configTypes';
import { CHAR, SERV } from '../utils/utils';
import { StreamingDelegate } from '../controller/streamingDelegate';
import { RecordingDelegate } from '../controller/recordingDelegate';

// A semi-complete description of the UniFi Protect camera channel JSON.
export interface ProtectCameraChannelConfig {

  bitrate: number;
  enabled: boolean;
  fps: number;
  height: number;
  id: number;
  idrInterval: number;
  isRtspEnabled: boolean;
  name: string;
  width: number;
}

export interface RtspEntry {

  channel: ProtectCameraChannelConfig;
  lens?: number;
  name: string;
  resolution: Resolution;
  url: string;
}

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

  public hardwareTranscoding: boolean = true;
  public hardwareDecoding: boolean = true;
  public timeshift: boolean = false;
  public hksvRecording: boolean = true;
  public HksvErrors: number = 0;

  public isOnline: boolean = true;

  public rtsp_url: string = '';

  public metadata!: StreamMetadata;

  public standalone: boolean = false;

  // List of event types
  public readonly eventTypesToHandle: (keyof DeviceEvents)[] = [
    'motion detected',
    'person detected',
    'pet detected',
    'vehicle detected',
    'sound detected',
    'crying detected',
    'dog detected',
    'stranger person detected',
  ];

  protected streamingDelegate: StreamingDelegate | null = null;
  protected recordingDelegate?: RecordingDelegate | null = null;

  public resolutions: Resolution[] = [
    [320, 180, 30],
    [320, 240, 15], // Apple Watch requires this configuration
    [320, 240, 30],
    [480, 270, 30],
    [480, 360, 30],
    [640, 360, 30],
    [640, 480, 30],
    [1280, 720, 30],
    [1280, 960, 30],
    [1920, 1080, 30],
    [1600, 1200, 30],
  ];

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: Camera,
  ) {
    super(platform, accessory, device);

    this.cameraConfig = {} as CameraConfig;

    this.cameraStatus = { isEnabled: false, timestamp: 0 }; // Initialize the cameraStatus object

    this.log.debug(`Constructed Camera`);

    this.cameraConfig = this.getCameraConfig();

    this.standalone = device.getSerial() === device.getStationSerial();

    this.log.debug(`Is standalone?`, this.standalone);

    if (this.cameraConfig.enableCamera || this.device.isDoorbell()) {
      if (this.cameraConfig.enableCamera) {
        this.log.debug(`Camera enabled: Setting up camera and chime button.`);
      } else {
        this.log.debug(`Device identified as a doorbell: Setting up camera and chime button.`);
      }
      this.setupCamera();
      this.setupChimeButton();
    } else {
      this.log.debug(`has a motion sensor: Setting up motion.`);
      this.setupMotionFunction();
    }

    this.initSensorService();

    this.setupEnableButton();
    this.setupMotionButton();
    this.setupLightButton();

    this.pruneUnusedServices();
  }

  private setupCamera() {
    try {
      this.cameraFunction();
    } catch (error) {
      this.log.error(`while happending CameraFunction ${error}`);
    }

    try {
      this.configureVideoStream();
    } catch (error) {
      this.log.error(`while happending Delegate ${error}`);
    }
  }

  private setupButtonService(
    serviceName: string,
    configValue: boolean | undefined,
    PropertyName: PropertyName,
    serviceType: 'switch' | 'lightbulb',
  ) {
    try {
      this.log.debug(`${serviceName} config:`, configValue);
      if (configValue && this.device.hasProperty(PropertyName)) {
        // eslint-disable-next-line max-len
        this.log.debug(`has a ${PropertyName}, so append ${serviceType}${serviceName} characteristic to it.`);
        this.setupSwitchService(serviceName, serviceType, PropertyName);
      } else {
        // eslint-disable-next-line max-len
        this.log.debug(`Looks like not compatible with ${PropertyName} or this has been disabled within configuration`);
      }
    } catch (error) {
      this.log.error(`raise error to check and attach ${serviceType}${serviceName}.`, error);
      throw Error;
    }
  }

  protected setupSwitchService(
    serviceName: string,
    serviceType: 'switch' | 'lightbulb' | 'outlet',
    propertyName: PropertyName,
  ) {
    const platformServiceMapping = {
      switch: SERV.Switch,
      lightbulb: SERV.Lightbulb,
      outlet: SERV.Outlet,
    };

    this.registerCharacteristic({
      serviceType: platformServiceMapping[serviceType] || SERV.Switch,
      characteristicType: CHAR.On,
      name: this.accessory.displayName + ' ' + serviceName,
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

    // Initialize videoConfig if it's undefined
    if (!config.videoConfig) {
      config.videoConfig = {};
    }

    config.videoConfig!.debug = config.videoConfig?.debug ?? true;

    // Validate talkback setting
    if (config.talkback && !this.device.hasCommand(CommandName.DeviceStartTalkback)) {
      this.log.warn('Talkback for this device is not supported!');
      config.talkback = false;
    }

    // Validate talkback with rtsp setting
    if (config.talkback && config.rtsp) {
      this.log.warn('Talkback cannot be used with rtsp option. Ignoring talkback setting.');
      config.talkback = false;
    }

    this.log.debug(`config is`, config);

    return config as CameraConfig;
  }

  private cameraFunction() {

    if (!this.cameraConfig.hsv) {
      this.registerCharacteristic({
        serviceType: SERV.CameraOperatingMode,
        characteristicType: CHAR.EventSnapshotsActive,
        getValue: () => this.handleDummyEventGet('EventSnapshotsActive'),
        setValue: (value) => this.handleDummyEventSet('EventSnapshotsActive', value),
      });

      this.registerCharacteristic({
        serviceType: SERV.CameraOperatingMode,
        characteristicType: CHAR.HomeKitCameraActive,
        getValue: (data, characteristic) =>
          this.getCameraPropertyValue(characteristic, PropertyName.DeviceEnabled),
        setValue: (value, characteristic) =>
          this.setCameraPropertyValue(characteristic, PropertyName.DeviceEnabled, value),
        onValue: (service, characteristic) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.device.on('property changed', (device: any, name: string, value: PropertyValue) => {
            this.applyPropertyValue(characteristic, PropertyName.DeviceEnabled, value);
          });
        },
      });

      if (this.device.hasProperty('enabled')) {
        this.registerCharacteristic({
          serviceType: SERV.CameraOperatingMode,
          characteristicType: CHAR.ManuallyDisabled,
          getValue: (data, characteristic) =>
            this.getCameraPropertyValue(characteristic, PropertyName.DeviceEnabled),
          onValue: (service, characteristic) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.device.on('property changed', (device: any, name: string, value: PropertyValue) => {
              this.applyPropertyValue(characteristic, PropertyName.DeviceEnabled, value);
            });
          },
        });
      }

      if (this.device.hasProperty('statusLed')) {
        this.registerCharacteristic({
          serviceType: SERV.CameraOperatingMode,
          characteristicType: CHAR.CameraOperatingModeIndicator,
          getValue: (data, characteristic) =>
            this.getCameraPropertyValue(characteristic, PropertyName.DeviceStatusLed),
          setValue: (value, characteristic) =>
            this.setCameraPropertyValue(characteristic, PropertyName.DeviceStatusLed, value),
          onValue: (service, characteristic) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.device.on('property changed', (device: any, name: string, value: PropertyValue) => {
              this.applyPropertyValue(characteristic, PropertyName.DeviceStatusLed, value);
            });
          },
        });
      }

      if (this.device.hasProperty('nightvision')) {
        this.registerCharacteristic({
          serviceType: SERV.CameraOperatingMode,
          characteristicType: CHAR.NightVision,
          getValue: (data, characteristic) =>
            this.getCameraPropertyValue(characteristic, PropertyName.DeviceNightvision),
          setValue: (value, characteristic) =>
            this.setCameraPropertyValue(characteristic, PropertyName.DeviceNightvision, value),
          onValue: (service, characteristic) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.device.on('property changed', (device: any, name: string, value: PropertyValue) => {
              this.applyPropertyValue(characteristic, PropertyName.DeviceNightvision, value);
            });
          },
        });
      }

      if (this.device.hasProperty('autoNightvision')) {
        this.registerCharacteristic({
          serviceType: SERV.CameraOperatingMode,
          characteristicType: CHAR.NightVision,
          getValue: (data, characteristic) =>
            this.getCameraPropertyValue(characteristic, PropertyName.DeviceAutoNightvision),
          setValue: (value, characteristic) =>
            this.setCameraPropertyValue(characteristic, PropertyName.DeviceAutoNightvision, value),
          onValue: (service, characteristic) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.device.on('property changed', (device: any, name: string, value: PropertyValue) => {
              this.applyPropertyValue(characteristic, PropertyName.DeviceAutoNightvision, value);
            });
          },
        });
      }

      this.getService(SERV.CameraOperatingMode).setPrimaryService(true);
    }

    // Fire snapshot when motion detected
    this.registerCharacteristic({
      serviceType: SERV.MotionSensor,
      characteristicType: CHAR.MotionDetected,
      getValue: () => this.device.getPropertyValue(PropertyName.DeviceMotionDetected),
      onValue: (service, characteristic) => {
        this.eventTypesToHandle.forEach(eventType => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.device.on(eventType as keyof any, (device: any, state: any) => {
            // eslint-disable-next-line max-len
            this.log.info(`MOTION DETECTED (${eventType})': ${state}`);
            characteristic.updateValue(state);
          });
        });
      },
    });

    // if (this.device.hasProperty('speaker')) {
    //   this.registerCharacteristic({
    //     serviceType: SERV.Speaker,
    //     characteristicType: CHAR.Mute,
    //     serviceSubType: 'speaker_mute',
    //     getValue: (data, characteristic) =>
    //       this.getCameraPropertyValue(characteristic, PropertyName.DeviceSpeaker),
    //     setValue: (value, characteristic) =>
    //       this.setCameraPropertyValue(characteristic, PropertyName.DeviceSpeaker, value),
    //   });
    // }

    // if (this.device.hasProperty('speakerVolume')) {
    //   this.registerCharacteristic({
    //     serviceType: SERV.Speaker,
    //     characteristicType: CHAR.Volume,
    //     serviceSubType: 'speaker_volume',
    //     getValue: (data, characteristic) =>
    //       this.getCameraPropertyValue(characteristic, PropertyName.DeviceSpeakerVolume),
    //     setValue: (value, characteristic) =>
    //       this.setCameraPropertyValue(characteristic, PropertyName.DeviceSpeakerVolume, value),
    //   });
    // }

    // if (this.device.hasProperty('microphone')) {
    //   this.registerCharacteristic({
    //     serviceType: SERV.Microphone,
    //     characteristicType: CHAR.Mute,
    //     serviceSubType: 'mic_mute',
    //     getValue: (data, characteristic) =>
    //       this.getCameraPropertyValue(characteristic, PropertyName.DeviceMicrophone),
    //     setValue: (value, characteristic) =>
    //       this.setCameraPropertyValue(characteristic, PropertyName.DeviceMicrophone, value),
    //   });
    // }

    if (this.device.isDoorbell()) {
      this.registerCharacteristic({
        serviceType: SERV.Doorbell,
        characteristicType: CHAR.ProgrammableSwitchEvent,
        onValue: (service, characteristic) => {
          this.device.on('rings', () => this.onDeviceRingsPushNotification(characteristic),
          );
        },
      });
    }

  }

  // This private function sets up the motion sensor characteristics for the accessory.
  private setupMotionFunction() {
    // Register the motion sensor characteristic for detecting motion.
    this.registerCharacteristic({
      serviceType: SERV.MotionSensor,
      characteristicType: CHAR.MotionDetected,
      getValue: () => this.device.getPropertyValue(PropertyName.DeviceMotionDetected),
      onMultipleValue: this.eventTypesToHandle,
    });

    // If the camera is disabled, flag the motion sensor as tampered.
    // This is done because the motion sensor won't work until the camera is enabled again.
    this.registerCharacteristic({
      serviceType: SERV.MotionSensor,
      characteristicType: CHAR.StatusTampered,
      getValue: () => {
        const tampered = this.device.getPropertyValue(PropertyName.DeviceEnabled);
        this.log.debug(`TAMPERED? ${!tampered}`);
        return tampered
          ? CHAR.StatusTampered.NOT_TAMPERED
          : CHAR.StatusTampered.TAMPERED;
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected getCameraPropertyValue(characteristic: any, propertyName: PropertyName): CharacteristicValue {
    try {
      const value = this.device.getPropertyValue(propertyName);
      return this.applyPropertyValue(characteristic, propertyName, value);
    } catch (error) {
      this.log.debug(`Error getting '${characteristic.displayName}' ${propertyName}: ${error}`);
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected applyPropertyValue(characteristic: any, propertyName: PropertyName, value: PropertyValue): CharacteristicValue {
    this.log.debug(`GET '${characteristic.displayName}' ${propertyName}: ${value}`);

    if (propertyName === PropertyName.DeviceNightvision) {
      return value === 1;
    }

    // Override for PropertyName.DeviceEnabled when enabled button is fired and 
    if (
      propertyName === PropertyName.DeviceEnabled &&
      Date.now() - this.cameraStatus.timestamp <= 60000
    ) {
      // eslint-disable-next-line max-len
      this.log.debug(`CACHED for (1 min) '${characteristic.displayName}' ${propertyName}: ${this.cameraStatus.isEnabled}`);
      value = this.cameraStatus.isEnabled;
    }

    if (characteristic.displayName === 'Manually Disabled') {
      value = !value;
      this.log.debug(`INVERSED '${characteristic.displayName}' ${propertyName}: ${value}`);
    }

    if (value === undefined) {
      throw (`Value is undefined: this shouldn't happend`);
    }

    return value as CharacteristicValue;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async setCameraPropertyValue(characteristic: any, propertyName: PropertyName, value: CharacteristicValue) {
    try {
      this.log.debug(`SET '${characteristic.displayName}' ${propertyName}: ${value}`);
      await this.setPropertyValue(propertyName, value);

      if (
        propertyName === PropertyName.DeviceEnabled &&
        characteristic.displayName === 'On'
      ) {
        characteristic.updateValue(value);

        this.cameraStatus = { isEnabled: value as boolean, timestamp: Date.now() };
        characteristic = this.getService(SERV.CameraOperatingMode)
          .getCharacteristic(CHAR.ManuallyDisabled);

        this.log.debug(`INVERSED '${characteristic.displayName}' ${propertyName}: ${!value}`);
        value = !value as boolean;
      }

      characteristic.updateValue(value);
    } catch (error) {
      this.log.debug(`Error setting '${characteristic.displayName}' ${propertyName}: ${error}`);
    }
  }

  /**
   * Handle push notifications for a doorbell device.
   * Mute subsequent notifications within a timeout period.
   * @param characteristic - The Characteristic to update for HomeKit.
   */
  private onDeviceRingsPushNotification(characteristic: Characteristic): void {
    if (!this.notificationTimeout) {
      this.log.debug(`DoorBell ringing`);
      characteristic.updateValue(CHAR.ProgrammableSwitchEvent.SINGLE_PRESS);
      // Set a new timeout for muting subsequent notifications
      this.notificationTimeout = setTimeout(() => {
        this.notificationTimeout = null;
      }, 15 * 1000);
    }
  }

  // Get the current bitrate for a specific camera channel.
  public getBitrate(): number {
    return -1;
  }


  // Set the bitrate for a specific camera channel.
  public async setBitrate(): Promise<boolean> {
    return true;
  }

  // Configure a camera accessory for HomeKit.
  private configureVideoStream(): boolean {
    this.log.debug(`configureVideoStream`);

    try {
      this.log.debug(`StreamingDelegate`);
      this.streamingDelegate = new StreamingDelegate(this);

      this.log.debug(`RecordingDelegate`);
      this.recordingDelegate = new RecordingDelegate(
        this.platform,
        this.accessory,
        this.device,
        this.cameraConfig,
        this.streamingDelegate.getLivestreamManager(),
      );

      this.log.debug(`Controller`);
      const controller = new this.platform.api.hap.CameraController(this.getCameraControllerOptions());

      this.log.debug(`streamingDelegate.setController`);
      this.streamingDelegate.setController(controller);

      if (this.cameraConfig.hsv) {
        this.log.debug(`recordingDelegate.setController`);
        this.recordingDelegate.setController(controller);
      }

      this.log.debug(`configureController`);
      this.accessory.configureController(controller);

    } catch (error) {
      this.log.error(`while happending Delegate ${error}`);
    }
    return true;
  }

  private getCameraControllerOptions(): CameraControllerOptions {

    const option: CameraControllerOptions = {
      cameraStreamCount: this.cameraConfig.videoConfig?.maxStreams || 2, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: this.streamingDelegate as StreamingDelegate,
      streamingOptions: {
        supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: this.resolutions,
          codec: {
            profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
            levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
          },
        },
        audio: {
          twoWayAudio: this.cameraConfig.talkback,
          codecs: [
            {
              type: AudioStreamingCodecType.AAC_ELD,
              samplerate: AudioStreamingSamplerate.KHZ_16,
            },
          ],
        },
      },
      recording: this.cameraConfig.hsv
        ? {
          options: {
            overrideEventTriggerOptions: [
              EventTriggerOption.MOTION,
              EventTriggerOption.DOORBELL,
            ],
            prebufferLength: 0, // prebufferLength always remains 4s ?
            mediaContainerConfiguration: [
              {
                type: MediaContainerType.FRAGMENTED_MP4,
                fragmentLength: 4000,
              },
            ],
            video: {
              type: this.platform.api.hap.VideoCodecType.H264,
              parameters: {
                profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
                levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
              },
              resolutions: this.resolutions,
            },
            audio: {
              codecs: {
                type: AudioRecordingCodecType.AAC_ELD,
                samplerate: AudioRecordingSamplerate.KHZ_24,
                bitrateMode: 0,
                audioChannels: 1,
              },
            },
          },
          delegate: this.recordingDelegate as RecordingDelegate,
        }
        : undefined,
      sensors: this.cameraConfig.hsv
        ? {
          motion: this.getService(SERV.MotionSensor),
          occupancy: undefined,
        }
        : undefined,
    };

    return option;
  }

}