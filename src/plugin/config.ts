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
  CameraMaxLivestreamDuration: number;
  pollingIntervalMinutes: number;
  hkHome: number;
  hkAway: number;
  hkNight: number;
  hkOff: number;
  ignoreStations: string[];
  ignoreDevices: string[];
  country: string;
  cameras: CameraConfig[];
  stations: StationConfig[];
  cleanCache: boolean;
  unbridge: boolean;
  verboseFfmpeg: boolean;
  videoProcessor: string;
  videoEncoder: string;
  autoSyncStation: boolean;
}

export const DEFAULT_CONFIG_VALUES = {
  enableDetailedLogging: false,
  CameraMaxLivestreamDuration: 30,
  pollingIntervalMinutes: 10,
  hkHome: 1,
  hkAway: 0,
  hkNight: 3,
  hkOff: 63,
  ignoreStations: [],
  ignoreDevices: [],
  country: 'US',
  cameras: [],
  cleanCache: true,
  unbridge: true,
  ignoreMultipleDevicesWarning: false,
  syncStationModes: false,
  verboseFfmpeg: false,
  videoEncoder: 'libx264',
  videoProcessor: 'ffmpeg',
  autoSyncStation: false,
};