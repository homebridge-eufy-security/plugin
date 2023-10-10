/* eslint-disable max-len */
import {
  PlatformAccessory,
  Characteristic,
  CharacteristicValue,
  Resolution,
  CameraController,
  CameraControllerOptions,
  SRTPCryptoSuites,
  H264Profile,
  H264Level,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  EventTriggerOption,
  MediaContainerType,
  AudioRecordingCodecType,
  AudioRecordingSamplerate,
  CameraStreamingOptions,
  CameraRecordingOptions,
} from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { Camera, Device, DeviceEvents, PropertyName, CommandName, PropertyValue } from '@homebridge-eufy-security/eufy-security-client';

import { StreamingDelegate } from '../controller/streamingDelegate';
import { RecordingDelegate } from '../controller/recordingDelegate';

import { CameraConfig, DEFAULT_CAMERACONFIG_VALUES } from '../utils/configTypes';

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

  private rtspEntries: RtspEntry[] = [];
  private rtspQuality: { [index: string]: string } = {};
  public hasHksv: boolean = false;
  private isVideoConfigured: boolean = false;
  public rtsp_url: string = '';

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

  public streamingDelegate: StreamingDelegate | null = null;
  public recordingDelegate?: RecordingDelegate | null = null;

  private resolutions: Resolution[] = [
    [320, 180, 30],
    [320, 240, 15], // Apple Watch requires this configuration
    [320, 240, 30],
    [480, 270, 30],
    [480, 360, 30],
    [640, 360, 30],
    [640, 480, 30],
    [1280, 720, 30],
    [1280, 960, 30],
    [1600, 1200, 30],
    [1920, 1080, 30],
  ];

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    device: Camera,
  ) {
    super(platform, accessory, device);

    this.cameraConfig = {} as CameraConfig;

    this.cameraStatus = { isEnabled: false, timestamp: 0 }; // Initialize the cameraStatus object

    this.log.debug(`${this.accessory.displayName} Constructed Camera`);

    this.cameraConfig = this.getCameraConfig();

    if (this.cameraConfig.enableCamera || this.device.isDoorbell()) {
      this.log.debug(`${this.accessory.displayName} has a camera`);
      this.setupCamera();
      this.setupChimeButton();
      this.initSensorService(this.platform.Service.Battery);
    } else {
      this.log.debug(`${this.accessory.displayName} has a motion sensor`);
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
      this.log.error(`${this.accessory.displayName} while happending CameraFunction ${error}`);
    }

    try {
      // this.setupRTSP()
      //   .then((rtspUrl) => {
      //     this.rtsp_url = rtspUrl as string;
      //     this.log.info(`${this.accessory.displayName} RTSP url: ${rtspUrl}`);

      //   })
      //   .catch((error) => {
      //     // Handle any errors that occur during the promise chain
      //     this.log.error('Error in setupRTSP:', error);
      //   });
      // Configure HomeKit Secure Video suport.
      this.configureHksv();
      this.configureVideoStream();
      
    } catch (error) {
      this.log.error(`${this.accessory.displayName} while happending Delegate ${error}`);
    }
  }

  private getCameraStreamingOptions(): CameraStreamingOptions {
    return {
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
    };
  }

  private getCameraRecordingOptions(): CameraRecordingOptions {
    return {
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
        type: this.hap.VideoCodecType.H264,
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
    };
  }

  private getCameraControllerOptions(): CameraControllerOptions {

    const option: CameraControllerOptions = {
      cameraStreamCount: this.cameraConfig.videoConfig?.maxStreams || 2, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: this.streamingDelegate as StreamingDelegate,
      streamingOptions: this.getCameraStreamingOptions(),
      recording: this.cameraConfig.hsv
        ? {
          options: this.getCameraRecordingOptions(),
          delegate: this.recordingDelegate as RecordingDelegate,
        }
        : undefined,
      sensors: this.cameraConfig.hsv
        ? {
          motion: this.getService(this.platform.Service.MotionSensor),
          occupancy: undefined,
        }
        : undefined,
    };

    return option;
  }

  /**
   * Sets up RTSP and waits for the DeviceRTSPStreamUrl property to change.
   * @returns {Promise<void>}
   */
  private async setupRTSP(): Promise<PropertyValue> {
    return new Promise<PropertyValue>((resolve, reject) => {
      // Set a timeout to reject the promise after 10 seconds
      const timeout = setTimeout(() => {
        this.log.error('Timeout waiting for RTSP Stream URL');
        reject(new Error('Timeout waiting for RTSP Stream URL'));
      }, 10000);

      if (this.device.hasProperty(PropertyName.DeviceRTSPStream)) {
        if (!this.device.getPropertyValue(PropertyName.DeviceRTSPStream)) {
          this.setPropertyValue(PropertyName.DeviceRTSPStream, true)
            .then(() => {
              this.log.info(`${this.accessory.displayName} enabling RTSP`);

              // Register for property changes
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              this.device.on('property changed', (device: any, name: string, value: PropertyValue) => {
                if (name === PropertyName.DeviceRTSPStreamUrl && value !== undefined) {
                  clearTimeout(timeout); // Clear the timeout
                  resolve(value);
                }
              });
            })
            .catch((error) => {
              clearTimeout(timeout); // Clear the timeout
              this.log.error('Error setting RTSP property:', error);
              reject(error);
            });
        } else {
          clearTimeout(timeout); // Clear the timeout
          this.log.info(`${this.accessory.displayName} RTSP enabled`);
          resolve(this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl));
        }
      } else {
        clearTimeout(timeout); // Clear the timeout
        reject(`${this.accessory.displayName} no RTSP settings found`);
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
      this.log.debug(`${this.accessory.displayName} ${serviceName} config:`, configValue);
      if (configValue && this.device.hasProperty(PropertyName)) {
        // eslint-disable-next-line max-len
        this.log.debug(`${this.accessory.displayName} has a ${PropertyName}, so append ${serviceType}${serviceName} characteristic to it.`);
        this.setupSwitchService(serviceName, serviceType, PropertyName);
      } else {
        // eslint-disable-next-line max-len
        this.log.debug(`${this.accessory.displayName} Looks like not compatible with ${PropertyName} or this has been disabled within configuration`);
      }
    } catch (error) {
      this.log.error(`${this.accessory.displayName} raise error to check and attach ${serviceType}${serviceName}.`, error);
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
      this.log.warn(this.accessory.displayName, 'Talkback for this device is not supported!');
      config.talkback = false;
    }

    // Validate talkback with rtsp setting
    if (config.talkback && config.rtsp) {
      this.log.warn(this.accessory.displayName, 'Talkback cannot be used with rtsp option. Ignoring talkback setting.');
      config.talkback = false;
    }

    this.log.debug(`${this.accessory.displayName} config is: ${JSON.stringify(config)}`);

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
            this.log.info(`${this.accessory.displayName} MOTION DETECTED (${eventType})': ${state}`);
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
        this.log.debug(`${this.accessory.displayName} TAMPERED? ${!tampered}`);
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

      this.log.debug(`${this.accessory.displayName} GET '${characteristic.displayName}' ${propertyName}: ${value}`);

      if (propertyName === PropertyName.DeviceNightvision) {
        return value === 1;
      }

      // Override for PropertyName.DeviceEnabled when enabled button is fired and 
      if (
        propertyName === PropertyName.DeviceEnabled &&
        Date.now() - this.cameraStatus.timestamp <= 60000
      ) {
        // eslint-disable-next-line max-len
        this.log.debug(`${this.accessory.displayName} CACHED for (1 min) '${characteristic.displayName}' ${propertyName}: ${this.cameraStatus.isEnabled}`);
        value = this.cameraStatus.isEnabled;
      }

      if (characteristic.displayName === 'Manually Disabled') {
        value = !value;
        this.log.debug(`${this.accessory.displayName} INVERSED '${characteristic.displayName}' ${propertyName}: ${value}`);
      }

      if (value === undefined) {
        return false;
      }

      return value as CharacteristicValue;
    } catch (error) {
      this.log.debug(`${this.accessory.displayName} Error getting '${characteristic.displayName}' ${propertyName}: ${error}`);
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async setCameraPropertyValue(characteristic: any, propertyName: PropertyName, value: CharacteristicValue) {
    try {
      this.log.debug(`${this.accessory.displayName} SET '${characteristic.displayName}' ${propertyName}: ${value}`);
      await this.setPropertyValue(propertyName, value);

      if (
        propertyName === PropertyName.DeviceEnabled &&
        characteristic.displayName === 'On'
      ) {
        characteristic.updateValue(value);

        this.cameraStatus = { isEnabled: value as boolean, timestamp: Date.now() };
        characteristic = this.getService(this.platform.Service.CameraOperatingMode)
          .getCharacteristic(this.platform.Characteristic.ManuallyDisabled);

        this.log.debug(`${this.accessory.displayName} INVERSED '${characteristic.displayName}' ${propertyName}: ${!value}`);
        value = !value as boolean;
      }

      characteristic.updateValue(value);
    } catch (error) {
      this.log.debug(`${this.accessory.displayName} Error setting '${characteristic.displayName}' ${propertyName}: ${error}`);
    }
  }

  /**
   * Handle push notifications for a doorbell device.
   * Mute subsequent notifications within a timeout period.
   * @param characteristic - The Characteristic to update for HomeKit.
   */
  private onDeviceRingsPushNotification(characteristic: Characteristic): void {
    if (!this.notificationTimeout) {
      this.log.debug(`${this.accessory.displayName} DoorBell ringing`);
      characteristic.updateValue(this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
      // Set a new timeout for muting subsequent notifications
      this.notificationTimeout = setTimeout(() => { }, 3000);
    }
  }

  // Get the current bitrate for a specific camera channel.
  public getBitrate(channelId: number): number {
    return -1;
  }


  // Set the bitrate for a specific camera channel.
  public async setBitrate(channelId: number, value: number): Promise<boolean> {
    return true;
  }

  // Find an RTSP configuration for a given target resolution.
  private findRtspEntry(width: number, height: number, rtspEntries: RtspEntry[], defaultStream = this.rtspQuality['StreamingDefault']): RtspEntry | null {

    // No RTSP entries to choose from, we're done.
    if (!rtspEntries || !rtspEntries.length) {

      return null;
    }

    // Second, we check to see if we've set an explicit preference for stream quality.
    if (defaultStream) {

      defaultStream = defaultStream.toUpperCase();

      return rtspEntries.find(x => x.channel.name.toUpperCase() === defaultStream) ?? null;
    }

    // See if we have a match for our desired resolution on the camera. We ignore FPS - HomeKit clients seem to be able to handle it just fine.
    const exactRtsp = rtspEntries.find(x => (x.resolution[0] === width) && (x.resolution[1] === height));

    if (exactRtsp) {

      return exactRtsp;
    }

    // No match found, let's see what we have that's closest. We try to be a bit smart about how we select our stream - if it's an HD quality stream request (720p+),
    // we want to try to return something that's HD quality before looking for something lower resolution.
    if ((width >= 1280) && (height >= 720)) {

      const entry = rtspEntries.find(x => x.resolution[0] >= 1280);

      if (entry) {

        return entry;
      }
    }

    // If we didn't request an HD resolution, or we couldn't find anything HD to use, we try to find the highest resolution we can find that's at least our requested
    // width or larger. If we can't find anything that matches, we return the lowest resolution we have available.
    return rtspEntries.filter(x => x.resolution[0] >= width)?.pop() ?? rtspEntries[rtspEntries.length - 1];
  }

  // Find a streaming RTSP configuration for a given target resolution.
  public findRtsp(width: number, height: number, rtspEntries = this.rtspEntries, constrainPixels = 0): RtspEntry | null {

    // If we've imposed a constraint on the maximum dimensions of what we want due to a hardware limitation, filter out those entries.
    if (constrainPixels) {

      rtspEntries = rtspEntries.filter(x => (x.channel.width * x.channel.height) <= constrainPixels);
    }

    return this.findRtspEntry(width, height, rtspEntries);
  }

  // Configure HomeKit Secure Video support.
  private configureHksv(): boolean {

    this.hasHksv = true;

    // If we have smart motion events enabled, let's warn the user that things will not work quite the way they expect.
    if (this.accessory.getService(this.hap.Service.MotionSensor)) {
      this.log.info('WARNING: Motion detection and HomeKit Secure Video provide overlapping functionality. ' +
        'Only HomeKit Secure Video, when event recording is enabled in the Home app, will be used to trigger motion event notifications for this camera.');
    }

    return true;
  }

  // Configure a camera accessory for HomeKit.
  private configureVideoStream(): boolean {
    this.platform.log.debug(`${this.accessory.displayName} StreamingDelegate`);
    this.streamingDelegate = new StreamingDelegate(this);

    this.platform.log.debug(`${this.accessory.displayName} RecordingDelegate`);
    this.recordingDelegate = new RecordingDelegate(this);

    this.platform.log.debug(`${this.accessory.displayName} Controller`);
    const controller = new this.hap.CameraController(this.getCameraControllerOptions());

    this.platform.log.debug(`${this.accessory.displayName} streamingDelegate.setController`);
    this.streamingDelegate.setController(controller);

    if (this.cameraConfig.hsv) {
      this.platform.log.debug(`${this.accessory.displayName} recordingDelegate.setController`);
      this.recordingDelegate.setController(controller);
    }

    this.platform.log.debug(`${this.accessory.displayName} configureController`);
    this.accessory.configureController(controller);

    this.isVideoConfigured = true;

    return true;
  }

}