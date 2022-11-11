import { PlatformConfig } from 'homebridge';

import { CameraConfig, StationConfig } from './utils/configTypes';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export interface EufySecurityPlatformConfig extends PlatformConfig {
  username: string;
  password: string;
  deviceName: string;
  enableDetailedLogging: number;
  omitLogFiles: boolean;
  enableCamera: boolean;
  CameraMaxLivestreamDuration: number;
  pollingIntervalMinutes: number;
  hkHome: number;
  hkAway: number;
  hkNight: number;
  hkOff: number;
  ignoreStations: string[];
  ignoreDevices: string[];
  country: string;
  ffmpegdebug: boolean;
  cameras: CameraConfig[];
  stations: StationConfig[];
  cleanCache: boolean;
}