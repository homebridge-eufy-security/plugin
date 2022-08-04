import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  AudioStreamingSamplerate,
  CameraControllerOptions,
  AudioStreamingCodecType,
  AudioRecordingSamplerate,
  AudioRecordingCodecType,
} from 'homebridge';

import { EufySecurityPlatform } from '../platform';
import { DeviceAccessory } from './Device';
import { Camera, Device, PropertyName, CommandName, VideoCodec, PropertyValue } from 'eufy-security-client';
import { StreamingDelegate } from '../controller/streamingDelegate';

import { CameraConfig } from '../utils/configTypes';
import { RecordingDelegate } from '../controller/recordingDelegate';

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
  protected recordingDelegate?: RecordingDelegate;

  protected cameraControllerOptions?: CameraControllerOptions;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: Camera,
    isDoorbell = false,
  ) {
    super(platform, accessory, eufyDevice);

    this.service = {} as Service;
    this.CameraService = {} as Service;
    this.cameraConfig = {} as CameraConfig;

    this.platform.log.debug(this.accessory.displayName, 'Constructed Camera');

    this.cameraConfig = this.getCameraConfig();
    this.platform.log.debug(this.accessory.displayName, 'config is:', this.cameraConfig);

    try {
      this.service = this.motionFunction(accessory);
    } catch (Error) {
      this.platform.log.error(this.accessory.displayName, 'raise error to check and attach motion function.', Error);
    }

    if (this.cameraConfig.enableCamera || (typeof this.eufyDevice.isDoorbell === 'function' && this.eufyDevice.isDoorbell())) {
      this.platform.log.debug(this.accessory.displayName, 'has a camera');

      try {
        this.CameraService = this.cameraFunction(accessory);
        this.CameraService.setPrimaryService(true);
        const delegate = new StreamingDelegate(this.platform, eufyDevice, this.cameraConfig, this.platform.api, this.platform.api.hap);
        this.streamingDelegate = delegate;
        this.recordingDelegate = new RecordingDelegate(
          this.platform,
          this.accessory,
          eufyDevice,
          this.cameraConfig,
          this.streamingDelegate.getLivestreamManager(),
          this.platform.log,
        );

        let samplerate = AudioStreamingSamplerate.KHZ_16;
        if (this.cameraConfig.videoConfig?.audioSampleRate === 8) {
          samplerate = AudioStreamingSamplerate.KHZ_8;
        } else if (this.cameraConfig.videoConfig?.audioSampleRate === 24) {
          samplerate = AudioStreamingSamplerate.KHZ_24;
        }

        this.platform.log.debug(this.accessory.displayName, `Audio sample rate set to ${samplerate} kHz.`);

        this.cameraControllerOptions = {
          cameraStreamCount: this.cameraConfig.videoConfig?.maxStreams || 2, // HomeKit requires at least 2 streams, but 1 is also just fine
          delegate: this.streamingDelegate,
          streamingOptions: {
            supportedCryptoSuites: [this.platform.api.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
            video: {
              resolutions: [
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
              ],
              codec: {
                profiles: [
                  this.platform.api.hap.H264Profile.BASELINE,
                  this.platform.api.hap.H264Profile.MAIN,
                  this.platform.api.hap.H264Profile.HIGH,
                ],
                levels: [
                  this.platform.api.hap.H264Level.LEVEL3_1,
                  this.platform.api.hap.H264Level.LEVEL3_2,
                  this.platform.api.hap.H264Level.LEVEL4_0,
                ],
              },
            },
            audio: {
              twoWayAudio: this.cameraConfig.talkback,
              codecs: [
                {
                  type: AudioStreamingCodecType.AAC_ELD,
                  samplerate: samplerate,
                  /*type: AudioStreamingCodecType.OPUS,
                                samplerate: AudioStreamingSamplerate.KHZ_24*/
                },
              ],
            },
          },
          recording: this.cameraConfig.hsv
            ? {
              options: {
                overrideEventTriggerOptions: [
                  this.platform.api.hap.EventTriggerOption.MOTION,
                  this.platform.api.hap.EventTriggerOption.DOORBELL,
                ],
                prebufferLength: 0, // prebufferLength always remains 4s ?
                mediaContainerConfiguration: [
                  {
                    type: this.platform.api.hap.MediaContainerType.FRAGMENTED_MP4,
                    fragmentLength: 4000,
                  },
                ],
                video: {
                  type: this.platform.api.hap.VideoCodecType.H264,
                  parameters: {
                    profiles: [
                      this.platform.api.hap.H264Profile.BASELINE,
                      this.platform.api.hap.H264Profile.MAIN,
                      this.platform.api.hap.H264Profile.HIGH,
                    ],
                    levels: [
                      this.platform.api.hap.H264Level.LEVEL3_1,
                      this.platform.api.hap.H264Level.LEVEL3_2,
                      this.platform.api.hap.H264Level.LEVEL4_0,
                    ],
                  },
                  resolutions: [
                    [320, 180, 30],
                    [320, 240, 15],
                    [320, 240, 30],
                    [480, 270, 30],
                    [480, 360, 30],
                    [640, 360, 30],
                    [640, 480, 30],
                    [1280, 720, 30],
                    [1280, 960, 30],
                    [1920, 1080, 30],
                    [1600, 1200, 30],
                  ],
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
              delegate: this.recordingDelegate,
            }
            : undefined,
          sensors: this.cameraConfig.hsv
            ? {
              motion: this.service,
              // eslint-disable-next-line max-len
              // occupancy: this.accessory.getServiceById(this.platform.api.hap.Service.OccupancySensor, 'occupancy') || false, //not implemented yet
            }
            : undefined,
        };

        if (!isDoorbell) {
          const controller = new this.platform.api.hap.CameraController(this.cameraControllerOptions);
          this.streamingDelegate.setController(controller);
          this.recordingDelegate.setController(controller);
          accessory.configureController(controller);
        }
      } catch (Error) {
        this.platform.log.error(this.accessory.displayName, 'raise error to check and attach livestream function.', Error);
      }
      
    } else {
      this.platform.log.debug(this.accessory.displayName, 'has a motion sensor.');
    }

    try {
      this.platform.log.debug(this.accessory.displayName, 'enableButton config:', this.cameraConfig.enableButton);
      if (this.cameraConfig.enableButton
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
      if (this.cameraConfig.motionButton && this.eufyDevice.hasProperty('motionDetection')) {
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
    config.delayCameraSnapshot = config.delayCameraSnapshot ??= false;
    config.hsv = config.hsv ??= false;

    if (config.hsv && !this.platform.api.versionGreaterOrEqual('1.4.0')) {
      config.hsv = false;
      this.platform.log.warn(
        this.accessory.displayName,
        'HomeKit Secure Video is only supported by Homebridge version >1.4.0! Please update.',
      );
    }

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
      accessory.displayName,
    );

    service
      .getCharacteristic(this.characteristic.EventSnapshotsActive)
      .onGet(this.handleEventSnapshotsActiveGet.bind(this));
    service
      .getCharacteristic(this.characteristic.EventSnapshotsActive)
      .onSet(this.handleEventSnapshotsActiveSet.bind(this));

    service
      .getCharacteristic(this.characteristic.PeriodicSnapshotsActive)
      .onGet(this.handlePeriodicSnapshotsActiveGet.bind(this));
    service
      .getCharacteristic(this.characteristic.PeriodicSnapshotsActive)
      .onSet(this.handlePeriodicSnapshotsActiveSet.bind(this));

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
    const currentValue = this.characteristic.EventSnapshotsActive.ENABLE;
    this.platform.log.debug(this.accessory.displayName, 'GET EventSnapshotsActive:', currentValue);
    return currentValue;
  }

  /**
   * Handle requests to set the "Event Snapshots Active" characteristic
   */
  handleEventSnapshotsActiveSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'Will not SET EventSnapshotsActive:', value);
  }

  handlePeriodicSnapshotsActiveGet(): Promise<CharacteristicValue> {
    const currentValue = this.characteristic.PeriodicSnapshotsActive.ENABLE;
    this.platform.log.debug(this.accessory.displayName, 'GET PeriodicSnapshotsActive:', currentValue);
    return currentValue;
  }

  /**
   * Handle requests to set the "Periodic Snapshots Active" characteristic
   */
  handlePeriodicSnapshotsActiveSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'Will not SET PeriodicSnapshotsActive:', value);
  }

  /**
   * Handle requests to get the current value of the "HomeKit Camera Active" characteristic
   */
  handleHomeKitCameraActiveGet(): Promise<CharacteristicValue> {
    const currentValue = this.characteristic.HomeKitCameraActive.ON;
    this.platform.log.debug(this.accessory.displayName, 'GET HomeKitCameraActive:', currentValue);
    return currentValue;
  }

  /**
   * Handle requests to set the "HomeKit Camera Active" characteristic
   */
  handleHomeKitCameraActiveSet(value) {
    this.platform.log.debug(this.accessory.displayName, 'Will not SET HomeKitCameraActive:', value);
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

    this.eufyDevice.on('property changed', this.onPropertyChange.bind(this));

    return service as Service;
  }

  async handleMotionDetectedGet(): Promise<CharacteristicValue> {
    try {
      let currentValue = this.eufyDevice.getPropertyValue(PropertyName.DeviceMotionDetected);
      if (this.recordingDelegate?.isRecording()) {
        currentValue = true; // assume ongoing motion when HKSV is recording
        // HKSV will remove unnecessary bits of the recorded video itself when there is no more motion
        // but since eufy-security-client doesn't return a proper value for MotionDetected while
        // streaming we assume motion to be ongoing
        // otherwise the recording would almost always end prematurely
      }
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceMotionDetected:', currentValue);
      return currentValue as boolean;
    } catch {
      this.platform.log.debug(this.accessory.displayName, 'handleMotionDetectedGet', 'Wrong return value');
      return false;
    }
  }

  private onPropertyChange(_: Device, name: string, value: PropertyValue) {
    const motionValues = [
      'motionDetected',
      'personDetected',
      'petDetected',
    ];
    if (motionValues.indexOf(name) !== -1) {
      const isRecording = this.recordingDelegate?.isRecording();
      if (!isRecording) {
        const motionDetected = value as boolean;
        this.platform.log.debug(this.accessory.displayName, 'ON DeviceMotionDetected:', motionDetected);
        this.service
          .getCharacteristic(this.characteristic.MotionDetected)
          .updateValue(motionDetected);
      } else {
        this.platform.log.debug(this.accessory.displayName, 
          'ignore change of motion detected state, since HKSV is still recording.' +
          'The recording controller will reset the motion state afterwards.');
      }
    }
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
    if (this.cameraConfig.enableCamera) {
      this.CameraService.getCharacteristic(this.characteristic.ManuallyDisabled).updateValue(!value as boolean);
    }
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
