/* eslint @typescript-eslint/no-var-requires: "off" */
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

import { DeviceIdentifier, DeviceContainer } from './interfaces';

import { StationAccessory } from './accessories/StationAccessory';
import { EntrySensorAccessory } from './accessories/EntrySensorAccessory';
import { MotionSensorAccessory } from './accessories/MotionSensorAccessory';
import { CameraAccessory } from './accessories/CameraAccessory';
import { DoorbellCameraAccessory } from './accessories/DoorbellCameraAccessory';
import { KeypadAccessory } from './accessories/KeypadAccessory';
import { SmartLockAccessory } from './accessories/SmartLockAccessory';

import {
  EufySecurity,
  EufySecurityConfig,
  DeviceType,
  Station,
  EntrySensor,
  MotionSensor,
  Camera,
  DoorbellCamera,
  Keypad,
  Lock,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore 
} from 'eufy-security-client';

import bunyan from 'bunyan';
import bunyanDebugStream from 'bunyan-debug-stream';

export class EufySecurityPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public eufyClient: EufySecurity;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public readonly config: EufySecurityPlatformConfig;
  private eufyConfig: EufySecurityConfig;

  public log;

  constructor(
    public readonly hblog: Logger,
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

    if (this.config.enableDetailedLogging >= 1) {

      const plugin = require('../package.json');

      this.log = bunyan.createLogger({
        name: '[EufySecurity-' + plugin.version + ']',
        hostname: '',
        streams: [{
          level: (this.config.enableDetailedLogging === 2) ? 'trace' : 'debug',
          type: 'raw',
          stream: bunyanDebugStream({
            forceColor: true,
            showProcess: false,
            showPid: false,
            showDate: (time) => {
              return '[' + time.toLocaleString('en-US') + ']';
            },
          }),
        }],
        serializers: bunyanDebugStream.serializers,
      });
      this.log.info('Eufy Security Plugin: enableDetailedLogging on');
    } else {
      this.log = hblog;
    }

    this.eufyClient = (this.config.enableDetailedLogging === 2)
      ? new EufySecurity(this.eufyConfig, this.log)
      : new EufySecurity(this.eufyConfig);

    // Removing the ability to set Off(6) waiting Bropat feedback bropat/eufy-security-client#27
    this.config.hkOff = (this.config.hkOff === 6) ? 63 : this.config.hkOff;

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      // await this.createConnection();
      // run the method to discover / register your devices as accessories
      await this.discoverDevices();
    });

    this.log.info('Finished initializing Eufy Security Platform');
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

    try {
      await this.eufyClient.connect();
      this.log.debug('EufyClient connected ' + this.eufyClient.isConnected());
    } catch (e) {
      this.log.error('Error authenticating Eufy : ', e);
    }

    if (!this.eufyClient.isConnected()) {
      this.log.error('Not connected can\'t continue!');
      return;
    }

    await this.refreshData(this.eufyClient);

    this.eufyClient.on('push connect', () => {
      this.log.debug('Push Connected!');
    });
    this.eufyClient.on('push close', () => {
      this.log.warn('Push Closed!');
    });

    const eufyStations = await this.eufyClient.getStations();
    this.log.debug('Found ' + eufyStations.length + ' stations.');

    const devices: Array<DeviceContainer> = [];

    for (const station of eufyStations) {
      this.log.debug(
        'Found Station',
        station.getSerial(),
        station.getName(),
        DeviceType[station.getDeviceType()],
        station.getLANIPAddress(),
      );

      if (this.config.ignoreStations.indexOf(station.getSerial()) !== -1) {
        this.log.debug('Device ignored');
        continue;
      }

      const deviceContainer: DeviceContainer = {
        deviceIdentifier: {
          uniqueId: station.getSerial(),
          displayName: station.getName(),
          type: station.getDeviceType(),
          station: true,
        } as DeviceIdentifier,
        eufyDevice: station,
      };
      devices.push(deviceContainer);
    }

    const eufyDevices = await this.eufyClient.getDevices();
    this.log.debug('Found ' + eufyDevices.length + ' devices.');

    for (const device of eufyDevices) {
      this.log.debug(
        'Found device',
        device.getSerial(),
        device.getName(),
        DeviceType[device.getDeviceType()],
      );

      if (this.config.ignoreStations.indexOf(device.getStationSerial()) !== -1) {
        this.log.debug('Device ignored because station is ignored');
        continue;
      }

      if (this.config.ignoreDevices.indexOf(device.getSerial()) !== -1) {
        this.log.debug('Device ignored');
        continue;
      }

      const deviceContainer: DeviceContainer = {
        deviceIdentifier: {
          uniqueId: device.getSerial(),
          displayName: device.getName(),
          type: device.getDeviceType(),
          station: false,
        } as DeviceIdentifier,
        eufyDevice: device,
      };
      devices.push(deviceContainer);
    }

    const activeAccessoryIds: string[] = [];

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of devices) {

      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      let uuid = this.api.hap.uuid.generate(device.deviceIdentifier.uniqueId);

      // Checking Device Type if it's not a station, it will be the same serial number we will find 
      // in Device list and it will create the same UUID
      if (device.deviceIdentifier.type !== DeviceType.STATION && device.deviceIdentifier.station) {
        uuid = this.api.hap.uuid.generate('s_' + device.deviceIdentifier.uniqueId);
        this.log.debug('This device is not a station. Generating a new UUID to avoid any duplicate issue');
      }

      activeAccessoryIds.push(uuid);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(
        (accessory) => accessory.UUID === uuid,
      );

      if (existingAccessory) {
        // the accessory already exists

        if (this.register_accessory(
          existingAccessory,
          device.deviceIdentifier.type,
          device.eufyDevice,
          device.deviceIdentifier.station,
        )
        ) {
          this.log.info(
            'Restoring existing accessory from cache:',
            existingAccessory.displayName,
          );

          // update accessory cache with any changes to the accessory details and information
          this.api.updatePlatformAccessories([existingAccessory]);
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
            device.deviceIdentifier.station,
          )
        ) {
          this.log.info(
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

    // Cleaning cached accessory which are no longer exist

    const staleAccessories = this.accessories.filter(function (item) {
      return activeAccessoryIds.indexOf(item.UUID) === -1;
    });

    staleAccessories.forEach((staleAccessory) => {
      this.log.info(
        `Removing cached accessory ${staleAccessory.UUID} ${staleAccessory.displayName}`
      )
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [staleAccessory]);
    });

  }

  private register_accessory(
    accessory: PlatformAccessory,
    type: number,
    device,
    station: boolean,
  ) {

    this.log.debug(accessory.displayName, 'UUID:', accessory.UUID);

    /* Under development area

    This need to be rewrite 

    */

    if (station) {
      if (type !== DeviceType.STATION) {
        // Allowing camera but not the lock nor doorbell for now
        if (!(type === DeviceType.LOCK_BASIC
          || type === DeviceType.LOCK_ADVANCED
          || type === DeviceType.LOCK_BASIC_NO_FINGER
          || type === DeviceType.LOCK_ADVANCED_NO_FINGER
          || type === DeviceType.DOORBELL
          || type === DeviceType.BATTERY_DOORBELL
          || type === DeviceType.BATTERY_DOORBELL_2)) {
          this.log.warn(accessory.displayName, 'looks station but it\'s not could imply some errors', 'Type:', type);
          new StationAccessory(this, accessory, device as Station);
          return true;
        } else {
          return false;
        }
      }
    }

    switch (type) {
      case DeviceType.STATION:
        new StationAccessory(this, accessory, device as Station);
        break;
      case DeviceType.MOTION_SENSOR:
        new MotionSensorAccessory(this, accessory, device as MotionSensor);
        break;
      case DeviceType.CAMERA:
      case DeviceType.CAMERA2:
      case DeviceType.CAMERA_E:
      case DeviceType.CAMERA2C:
      case DeviceType.INDOOR_CAMERA:
      case DeviceType.INDOOR_PT_CAMERA:
      case DeviceType.FLOODLIGHT:
      case DeviceType.CAMERA2C_PRO:
      case DeviceType.CAMERA2_PRO:
      case DeviceType.INDOOR_CAMERA_1080:
      case DeviceType.INDOOR_PT_CAMERA_1080:
      case DeviceType.SOLO_CAMERA:
      case DeviceType.SOLO_CAMERA_PRO:
      case DeviceType.SOLO_CAMERA_SPOTLIGHT_1080:
      case DeviceType.SOLO_CAMERA_SPOTLIGHT_2K:
      case DeviceType.SOLO_CAMERA_SPOTLIGHT_SOLAR:
      case DeviceType.INDOOR_OUTDOOR_CAMERA_1080P:
      case DeviceType.INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT:
      case DeviceType.INDOOR_OUTDOOR_CAMERA_2K:
      case DeviceType.FLOODLIGHT_CAMERA_8422:
      case DeviceType.FLOODLIGHT_CAMERA_8423:
      case DeviceType.FLOODLIGHT_CAMERA_8424:
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
      case DeviceType.LOCK_BASIC:
      case DeviceType.LOCK_ADVANCED:
      case DeviceType.LOCK_BASIC_NO_FINGER:
      case DeviceType.LOCK_ADVANCED_NO_FINGER:
        new SmartLockAccessory(this, accessory, device as Lock);
        break;
      default:
        this.log.warn(
          'This accessory is not compatible with HomeBridge Eufy Security plugin:',
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

  public getStationById(id: string) {
    return this.eufyClient.getStation(id);
  }
}
