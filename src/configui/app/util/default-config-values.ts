import { CameraConfig } from '../../../plugin/utils/configTypes';
import { EufySecurityPlatformConfig } from '../../../plugin/config';

export const DEFAULT_CONFIG_VALUES: EufySecurityPlatformConfig = {
  platform: 'EufySecurity',
  name: 'EufySecurity',
  username: '',
  password: '',
  deviceName: 'MyPhone',
  enableDetailedLogging: false,
  omitLogFiles: false,
  CameraMaxLivestreamDuration: 30,
  pollingIntervalMinutes: 10,
  hkHome: 1,
  hkAway: 0,
  hkNight: 3,
  hkOff: 63,
  ignoreStations: [],
  ignoreDevices: [],
  country: 'US',
  stations: [],
  cameras: [],
  cleanCache: true,
  ignoreMultipleDevicesWarning: false,
  autoSyncStation: false,
  enableEmbeddedPKCS1Support: false,
};

export const DEFAULT_CAMERACONFIG_VALUES: CameraConfig = {
  enableButton: true,
  motionButton: true,
  lightButton: true,
  talkback: false,
  talkbackChannels: 1,
  hsv: false,
  hsvRecordingDuration: 90,
  rtsp: false,
  enableCamera: true,
  refreshSnapshotIntervalMinutes: 0,
  snapshotHandlingMethod: 3,
  immediateRingNotificationWithoutSnapshot: false,
  delayCameraSnapshot: false,
  indoorChimeButton: false,
};