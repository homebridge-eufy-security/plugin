import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { SecuritySystemPlatformAccessory } from './securitySystemPlatformAccessory';
import { EufySecurity } from 'eufy-security-client';
// import { HttpService, LocalLookupService, DeviceClientService, CommandType } from 'eufy-node-client';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */

interface EufySecurityPlatformConfig extends PlatformConfig {
  username: string;
  password: string;
  ipAddress: string;
}




export class EufySecurityPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;




  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  // public httpService: HttpService;
  private config: EufySecurityPlatformConfig;
  // public devClientService: DeviceClientService,

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,

  ) {
    this.config = config as EufySecurityPlatformConfig;
    this.log.debug('Finished initializing platform:', this.config.name);

    // this.httpService = new HttpService(this.config.username, this.config.password);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');

      // await this.createConnection();
      // run the method to discover / register your devices as accessories
      await this.discoverDevices();
    });
  }

  // async createConnection() {
  //   const hubs = await this.httpService.listHubs();
  //   const P2P_DID = hubs[0].p2p_did;
  //   const ACTOR_ID = hubs[0].member.action_user_id;

  //   const stationSn = hubs[0].station_sn;
  //   const dsk = await this.httpService.stationDskKeys(stationSn);
  //   const DSK_KEY = dsk.dsk_keys[0].dsk_key;

  //   this.log.info(`
  //   P2P_DID: ${P2P_DID}
  //   ACTOR_ID: ${ACTOR_ID}
  //   Station SN: ${stationSn}
  //   DSK_KEY: ${DSK_KEY}
  //   `)

  //   const lookupService = new LocalLookupService();
  //   const address = await lookupService.lookup(this.config.ipAddress);
  //   this.log.info('Found address', address);

  //   // this.devClientService = new DeviceClientService(address, P2P_DID, ACTOR_ID);
  //   // await this.devClientService.connect();
  //   // this.log.info('Connected!');
  // }

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

    // const hubs = await this.httpService.listHubs();
    // const P2P_DID = hubs[0].p2p_did;
    // const ACTOR_ID = hubs[0].member.action_user_id;

    // const stationSn = hubs[0].station_sn;
    // const dsk = await this.httpService.stationDskKeys(stationSn);
    // const DSK_KEY = dsk.dsk_keys[0].dsk_key;

    // this.log.info(`
    // P2P_DID: ${P2P_DID} //***REMOVED***
    // ACTOR_ID: ${ACTOR_ID}
    // Station SN: ${stationSn} //***REMOVED***
    // DSK_KEY: ${DSK_KEY}
    // `);

    // const lookupService = new LocalLookupService();
    // const address = await lookupService.lookup(this.config.ipAddress);
    // this.log.info('Found address', address);

    // const devClientService = new DeviceClientService(address, P2P_DID, ACTOR_ID);
    // await devClientService.connect();
    // this.log.info('Connected!');

    //const uuid = this.api.hap.uuid.generate(device.device_sn);

    // const devices = [
    //   {
    //     uniqueId: hubs[0].station_sn,
    //     displayName: 'Eufy Security',
    //     type: 'security-mode',
    //   },
    // ];

    const devices = [
      {
        uniqueId: '***REMOVED***',
        displayName: 'Eufy Security',
        type: 'security-mode',
      },
    ];


    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of devices) {

      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.uniqueId);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists
        if (device) {
          this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

          // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
          // existingAccessory.context.device = device;
          // this.api.updatePlatformAccessories([existingAccessory]);

          // create the accessory handler for the restored accessory
          // this is imported from `platformAccessory.ts`
          new SecuritySystemPlatformAccessory(this, existingAccessory);

          // update accessory cache with any changes to the accessory details and information
          this.api.updatePlatformAccessories([existingAccessory]);
        } else if (!device) {
          // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
          // remove platform accessories when no longer present
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
          this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
        }
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.error('Adding new accessory:', device.displayName);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.displayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        if (device.type === 'security-mode') {
          // new SecuritySystemPlatformAccessory(this, accessory, devClientService, this.httpService);
          new SecuritySystemPlatformAccessory(this, accessory);
        }
        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
