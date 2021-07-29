import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

import { EufySecurityPlatformConfig } from './config';

import { StationAccessory } from './accessories/StationAccessory';
import { EntrySensorAccessory } from './accessories/EntrySensorAccessory';
import { MotionSensorAccessory } from './accessories/MotionSensorAccessory';
import { CameraAccessory } from './accessories/CameraAccessory';
import { DoorbellCameraAccessory } from './accessories/DoorbellCameraAccessory';
import { KeypadAccessory } from './accessories/KeypadAccessory';

 
import {
  EufySecurity,
  EufySecurityConfig,
  DeviceType,
  Station,
  Device,
  EntrySensor,
  MotionSensor,
  Camera,
  DoorbellCamera,
  Keypad,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore 
} from 'eufy-security-client';
// import { throws } from 'assert';
import bunyan from 'bunyan';
const eufyLog = bunyan.createLogger({ name: 'eufyLog' });

interface DeviceIdentifier {
  uniqueId: string;
  displayName: string;
  type: number;
}

interface DeviceContainer {
  deviceIdentifier: DeviceIdentifier;
  eufyDevice: Device | Station;
}

export class EufySecurityPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public eufyClient: EufySecurity;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public config: EufySecurityPlatformConfig;
  private eufyConfig: EufySecurityConfig;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.config = config as EufySecurityPlatformConfig;

    this.eufyConfig = {
      username: this.config.username,
      password: this.config.password,
      country: 'US',
      language: 'en',
      persistentDir: api.user.storagePath(),
      p2pConnectionSetup: 0,
      pollingIntervalMinutes: this.config.pollingIntervalMinutes ?? 10,
      eventDurationSeconds: 10,
    } as EufySecurityConfig;

    this.log.debug('Finished initializing platform:', this.config.name);
    this.log.debug(
      'enableDetailedLogging: ' + this.config.enableDetailedLogging,
    );
    this.eufyClient = !this.config.enableDetailedLogging
      ? new EufySecurity(this.eufyConfig)
      : new EufySecurity(this.eufyConfig, eufyLog);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      // await this.createConnection();
      // run the method to discover / register your devices as accessories
      await this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  async discoverDevices() {
    this.log.debug('discoveringDevices');
    this.log.debug(this.eufyConfig.username);
    this.log.debug(this.eufyConfig.password);
    await this.eufyClient
      .connect()
      .catch((e) => this.log.error('Error authenticating Eufy : ', e));
    this.log.debug('EufyClient connected ' + this.eufyClient.isConnected());

    await this.refreshData(this.eufyClient);

    const eufyHubs = await this.eufyClient.getStations();
    const eufyDevices = await this.eufyClient.getDevices();

    this.log.debug('Found ' + eufyDevices.length + ' devices.');
    this.log.debug('Found ' + eufyHubs.length + ' hubs.');

    const devices: Array<DeviceContainer> = [];

    for (const device of eufyDevices) {
      this.log.debug('Found device ' + device.getName());
      const deviceContainer: DeviceContainer = {
        deviceIdentifier: {
          uniqueId: device.getSerial(),
          displayName: device.getName(),
          type: device.getDeviceType(),
        } as DeviceIdentifier,
        eufyDevice: device,
      };
      devices.push(deviceContainer);
    }

    for (const hub of eufyHubs) {
      this.log.debug('Found hub ' + hub.getName());
      const deviceContainer: DeviceContainer = {
        deviceIdentifier: {
          uniqueId: hub.getSerial(),
          displayName: hub.getName(),
          type: hub.getDeviceType(),
        } as DeviceIdentifier,
        eufyDevice: hub,
      };
      devices.push(deviceContainer);
    }

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of devices) {
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.deviceIdentifier.uniqueId);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(
        (accessory) => accessory.UUID === uuid,
      );

      if (existingAccessory) {
        // the accessory already exists
        if (device) {
          // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
          // existingAccessory.context.device = device;
          // this.api.updatePlatformAccessories([existingAccessory]);

          // create the accessory handler for the restored accessory
          // this is imported from `platformAccessory.ts`
          if (
            this.register_accessory(
              existingAccessory,
              device.deviceIdentifier.type,
              device.eufyDevice,
              this.config,
            )
          ) {
            this.log.debug(
              'Restoring existing accessory from cache:',
              existingAccessory.displayName,
            );

            // update accessory cache with any changes to the accessory details and information
            this.api.updatePlatformAccessories([existingAccessory]);
          }
        } else if (!device) {
          // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
          // remove platform accessories when no longer present
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            existingAccessory,
          ]);
          this.log.debug(
            'Removing existing accessory from cache:',
            existingAccessory.displayName,
          );
        }
      } else {
        // the accessory does not yet exist, so we need to create it

        // create a new accessory
        const accessory = new this.api.platformAccessory(
          device.deviceIdentifier.displayName,
          uuid,
        );

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device.deviceIdentifier;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        if (
          this.register_accessory(
            accessory,
            device.deviceIdentifier.type,
            device.eufyDevice,
            this.config,
          )
        ) {
          this.log.error(
            'Adding new accessory:',
            device.deviceIdentifier.displayName,
          );

          // link the accessory to your platform
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            accessory,
          ]);
        }
      }
    }
  }

  private register_accessory(
    accessory: PlatformAccessory,
    type: number,
    device,
    config: EufySecurityPlatformConfig,
  ) {
    switch (type) {
      case DeviceType.STATION:
        new StationAccessory(
          this,
          accessory,
          device as Station,
          config,
        );
        break;
      case DeviceType.MOTION_SENSOR:
        new MotionSensorAccessory(this, accessory, device as MotionSensor);
        break;
      case DeviceType.CAMERA:
      case DeviceType.CAMERA2:
      case DeviceType.CAMERA2C:
      case DeviceType.CAMERA2C_PRO:
      case DeviceType.CAMERA2_PRO:
      case DeviceType.CAMERA_E:
      case DeviceType.FLOODLIGHT:
      case DeviceType.INDOOR_CAMERA:
      case DeviceType.INDOOR_CAMERA_1080:
      case DeviceType.INDOOR_PT_CAMERA:
      case DeviceType.INDOOR_PT_CAMERA_1080:
      case DeviceType.SOLO_CAMERA:
      case DeviceType.SOLO_CAMERA_PRO:
        new CameraAccessory(this, accessory, device as Camera);
        break;
      case DeviceType.DOORBELL:
      case DeviceType.BATTERY_DOORBELL:
      case DeviceType.BATTERY_DOORBELL_2:
        new DoorbellCameraAccessory(this, accessory, device as DoorbellCamera);
        break;
      case DeviceType.SENSOR:
        new EntrySensorAccessory(this, accessory, device as EntrySensor);
        break;
      case DeviceType.KEYPAD:
        new KeypadAccessory(this, accessory, device as Keypad);
        break;
      default:
        this.log.warn(
          'This accessory is not compatible with this plugin:',
          accessory.displayName,
          'Type:',
          type,
        );
        return false;
    }
    return true;
  }

  public async refreshData(client: EufySecurity): Promise<void> {
    this.log.debug(
      `PollingInterval: ${this.eufyConfig.pollingIntervalMinutes}`,
    );
    if (client) {
      this.log.debug('Refresh data from cloud and schedule next refresh.');
      try {
        await client.refreshData();
      } catch (error) {
        this.log.error('Error refreshing data from Eufy: ', error);
      }
      setTimeout(() => {
        try {
          this.refreshData(client);
        } catch (error) {
          this.log.error('Error refreshing data from Eufy: ', error);
        }
      }, this.eufyConfig.pollingIntervalMinutes * 60 * 1000);
    }
  }

  public getStationById(id: string){
    return this.eufyClient.getStation(id);
  }
}
