import { PlatformConfig } from 'homebridge';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export interface EufySecurityPlatformConfig extends PlatformConfig {
  username: string;
  password: string;
  enableDetailedLogging: number;
  enableCamera: boolean;
  pollingIntervalMinutes: number;
  hkHome: number;
  hkAway: number;
  hkNight: number;
  hkOff: number;
  hkDisarmed: number;
  ignoreStations: string[];
  ignoreDevices: string[];
}