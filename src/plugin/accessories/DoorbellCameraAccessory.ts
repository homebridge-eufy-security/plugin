import { Service, PlatformAccessory, DoorbellOptions, CharacteristicValue } from 'homebridge';

import { EufySecurityPlatform } from '../platform';

// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  
import { DoorbellCamera, Device, PropertyName } from 'eufy-security-client';
import { CameraAccessory } from './CameraAccessory';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DoorbellCameraAccessory extends CameraAccessory {

  protected DoorbellCamera: DoorbellCamera;
  private ring_triggered: boolean;

  private doorbellService: Service;

  private indoorChimeSwitchService?: Service;

  constructor(
    platform: EufySecurityPlatform,
    accessory: PlatformAccessory,
    eufyDevice: DoorbellCamera,
  ) {
    super(platform, accessory, eufyDevice, true);
    this.DoorbellCamera = eufyDevice;

    this.platform.log.debug(this.accessory.displayName, 'Constructed Doorbell');

    this.doorbellService =
      this.accessory.getService(this.platform.Service.Doorbell) ||
      this.accessory.addService(this.platform.Service.Doorbell);

    this.ring_triggered = false;

    // set the Battery service characteristics
    this.doorbellService.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.displayName,
    );

    // create handlers for required characteristics of Battery service
    this.doorbellService
      .getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .onGet(() => null);

    this.DoorbellCamera.on('rings', (device: Device, state: boolean) =>
      this.onDeviceRingsPushNotification(),
    );

    if (this.cameraControllerOptions) {
      const doorbellOptions: DoorbellOptions = {
        externalDoorbellService: this.doorbellService,
      };
      const controller = new this.platform.api.hap.DoorbellController({...this.cameraControllerOptions, ...doorbellOptions});
      this.streamingDelegate?.setController(controller);
      this.recordingDelegate?.setController(controller);
      accessory.configureController(controller);
      this.cameraSetup(accessory);
    }

    this.doorbellService.setPrimaryService(true);

    // add indoor chime switch
    try {
      if ((this.eufyDevice.isBatteryDoorbell() || this.eufyDevice.isWiredDoorbell()) && this.cameraConfig.indoorChimeButton) {
        this.platform.log.debug(this.accessory.displayName, 'indoorChimeSwitch config:', this.cameraConfig.indoorChimeButton);
        this.platform.log.debug(this.accessory.displayName, 'has a indoorChime, so append indoorChimeSwitchService to it.');

        this.indoorChimeSwitchService =
          this.accessory.getService('indoorChimeSwitch') || 
          this.accessory.addService(this.platform.Service.Switch, 'indoorChimeSwitch', 'indoorChime');
        
        this.indoorChimeSwitchService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName + ' indoor chime');
        // this.indoorChimeSwitchService.setCharacteristic(this.platform.Characteristic.ConfiguredName,
        //   this.accessory.displayName + ' indoor chime');

        this.indoorChimeSwitchService.getCharacteristic(this.characteristic.On)
          .onGet(this.handleIndoorChimeGet.bind(this))
          .onSet(this.handleIndoorChimeSet.bind(this));
      } else {
        this.platform.log.debug(this.accessory.displayName,
          'Looks like not compatible with indoorChime or this has been disabled within configuration');

        // remove indoorChimeButton service if the user has disabled the it through the config
        this.indoorChimeSwitchService = accessory.getService('indoorChimeSwitch');
        if (this.indoorChimeSwitchService) {
          this.platform.log.debug(this.accessory.displayName, 'removing indoorChimeSwitch service.');
          accessory.removeService(this.indoorChimeSwitchService);
        }
      }

    } catch (err) {
      this.platform.log.error(this.accessory.displayName, 'raise error in indoorChimeSwitchService.', err);
    }
  }

  // We receive 2 push when Doorbell ring, mute the second by checking if we already send
  // the event to HK then reset the marker when 2nd times occurs
  private onDeviceRingsPushNotification(): void {
    if (!this.ring_triggered) {
      this.ring_triggered = true;
      this.platform.log.debug(this.accessory.displayName, 'DoorBell ringing');
      this.doorbellService
        .getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
        .updateValue(this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
    } else {
      this.ring_triggered = false;
    }
  }

  async handleIndoorChimeGet(): Promise<CharacteristicValue> {
    try {
      const currentValue = this.eufyDevice.getPropertyValue(PropertyName.DeviceChimeIndoor);
      this.platform.log.debug(this.accessory.displayName, 'GET DeviceChimeIndoor:', currentValue);
      return currentValue as boolean;
    } catch {
      this.platform.log.debug(this.accessory.displayName, 'handleIndoorChimeGet', 'Wrong return value');
      return false;
    }
  }

  async handleIndoorChimeSet(value: CharacteristicValue) {
    try {
      this.platform.log.debug(this.accessory.displayName, 'SET DeviceChimeIndoor:', value);
      const station = await this.platform.getStationById(this.eufyDevice.getStationSerial());
      await station.enableIndoorChime(this.eufyDevice, value as boolean);
    } catch (err) {
      this.platform.log.debug(this.accessory.displayName, 'handleIndoorChimeSet error', err);
    }
  }
}
