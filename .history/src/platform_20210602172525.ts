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

import { SecuritySystemPlatformAccessory } from './securitySystemPlatformAccessory';
import { SecurityEntrySensorAccessory } from './securityEntrySensorAccessory';
import { SecurityMotionSensorAccessory } from './securityMotionSensorAccessory';
import { SecurityCameraAccessory } from './securityCameraAccessory';

import {
  EufySecurity,
  EufySecurityConfig,
  DeviceType,
  Station,
  Device,
  EntrySensor,
  MotionSensor,
  Camera,
} from 'eufy-security-client';
// import { throws } from 'assert';
import bunyan from 'bunyan';
const eufyLog = bunyan.createLogger({ name: 'eufyLog' });

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
interface EufySecurityPlatformConfig extends PlatformConfig {
  username: string;
  password: string;
  ipAddress: string;
  enableDetailedLogging: boolean;
  pollingIntervalMinutes: number;
  eufyHome: string;
  eufyAway: string;
  eufySchedule: string;
  eufyC1: string;
  eufyC2: string;
  eufyC3: string;
  eufyC1: string;
  eufyC1: string;
}

export class EufySecurityPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic =
    this.api.hap.Characteristic;

  private eufyClient: EufySecurity;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  private config: EufySecurityPlatformConfig;
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
      p2pConnectionSetup: 0,
      pollingIntervalMinutes: this.config.pollingIntervalMinutes?? 10,
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
    this.log.info('Loading accessory from cache:', accessory.displayName);

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

    const hubsAndDevices: Array<Device | Station> = [];


    for (const device of eufyDevices) {
      this.log.debug('Found device ' + device.getName());
      hubsAndDevices.push(device);
    }

    for (const hub of eufyHubs) {
      this.log.debug('Found device ' + hub.getName());
      hubsAndDevices.push(hub);
    }

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of hubsAndDevices) {
      const uniqueId = device.getSerial();
      const displayName = device.getName();
      const type = device.getDeviceType();
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(uniqueId);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(
        (accessory) => accessory.UUID === uuid,
      );

      if (existingAccessory) {
        // the accessory already exists
        if (device) {
          this.log.info(
            'Restoring existing accessory from cache:',
            existingAccessory.displayName,
          );

          // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
          // existingAccessory.context.device = device;
          // this.api.updatePlatformAccessories([existingAccessory]);

          // create the accessory handler for the restored accessory
          // this is imported from `platformAccessory.ts`
          switch (type) {
            case DeviceType.STATION:
              new SecuritySystemPlatformAccessory(
                this,
                existingAccessory,
                this.eufyClient,
                device as Station,
                this.config,
              );
              break;
            case DeviceType.MOTION_SENSOR:
              new SecurityMotionSensorAccessory(
                this,
                existingAccessory,
                this.eufyClient,
                device as MotionSensor,
              );
              break;
            case DeviceType.CAMERA:
            case DeviceType.CAMERA2:
            case DeviceType.CAMERA2C:
            case DeviceType.CAMERA2C_PRO:
            case DeviceType.CAMERA2_PRO:
            case DeviceType.CAMERA_E:
            case DeviceType.DOORBELL:
            case DeviceType.BATTERY_DOORBELL:
            case DeviceType.BATTERY_DOORBELL_2:
            case DeviceType.FLOODLIGHT:
            case DeviceType.INDOOR_CAMERA:
            case DeviceType.INDOOR_CAMERA_1080:
            case DeviceType.INDOOR_PT_CAMERA:
            case DeviceType.INDOOR_PT_CAMERA_1080:
            case DeviceType.SOLO_CAMERA:
            case DeviceType.SOLO_CAMERA_PRO:
              new SecurityCameraAccessory(
                this,
                existingAccessory,
                this.eufyClient,
                device as Camera,
              );
              break;
            case DeviceType.SENSOR:
              new SecurityEntrySensorAccessory(
                this,
                existingAccessory,
                this.eufyClient,
                device as EntrySensor,
              );
              break;
            default:
              break;
          }

          // update accessory cache with any changes to the accessory details and information
          this.api.updatePlatformAccessories([existingAccessory]);
        } else if (!device) {
          // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
          // remove platform accessories when no longer present
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            existingAccessory,
          ]);
          this.log.info(
            'Removing existing accessory from cache:',
            existingAccessory.displayName,
          );
        }
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.error('Adding new accessory:', displayName);

        // create a new accessory
        const accessory = new this.api.platformAccessory(displayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`

        switch (type) {
          case DeviceType.STATION:
            new SecuritySystemPlatformAccessory(
              this,
              accessory,
              this.eufyClient,
              device as Station,
            );
            break;
          case DeviceType.MOTION_SENSOR:
            new SecurityMotionSensorAccessory(
              this,
              accessory,
              this.eufyClient,
              device as MotionSensor,
            );
            break;
          case DeviceType.CAMERA:
          case DeviceType.CAMERA2:
          case DeviceType.CAMERA2C:
          case DeviceType.CAMERA2C_PRO:
          case DeviceType.CAMERA2_PRO:
          case DeviceType.CAMERA_E:
          case DeviceType.DOORBELL:
          case DeviceType.BATTERY_DOORBELL:
          case DeviceType.BATTERY_DOORBELL_2:
          case DeviceType.FLOODLIGHT:
          case DeviceType.INDOOR_CAMERA:
          case DeviceType.INDOOR_CAMERA_1080:
          case DeviceType.INDOOR_PT_CAMERA:
          case DeviceType.INDOOR_PT_CAMERA_1080:
          case DeviceType.SOLO_CAMERA:
          case DeviceType.SOLO_CAMERA_PRO:
            new SecurityCameraAccessory(
              this,
              accessory,
              this.eufyClient,
              device as Camera,
            );
            break;
          case DeviceType.SENSOR:
            new SecurityEntrySensorAccessory(
              this,
              accessory,
              this.eufyClient,
              device as EntrySensor,
            );
            break;
          default:
            break;
        }

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory,
        ]);
      }
    }
  }

  public async refreshData(client: EufySecurity): Promise<void> {
    this.log.debug(
      `PollingInterval: ${this.eufyConfig.pollingIntervalMinutes}`,
    );
    if (client) {
      this.log.debug('Refresh data from cloud and schedule next refresh.');
      await client.refreshData();
      setTimeout(() => {
        this.refreshData(client);
      }, this.eufyConfig.pollingIntervalMinutes * 60 * 1000);
    }
  }
}
