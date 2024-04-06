import { CameraConfig } from '../../../plugin/utils/configTypes';

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
  ignoreMultipleDevicesWarning: false,
  syncStationModes: false,
  autoSyncStation: false,
};

export const DEFAULT_CAMERACONFIG_VALUES:CameraConfig = {
  enableButton: true,
  motionButton: true,
  lightButton: true,
  talkback: false,
  talkbackChannels: 1,
  hsv: false,
  hsvRecordingDuration: 90,
  rtsp: false,
  enableCamera: true,
  forcerefreshsnap: false,
  refreshSnapshotIntervalMinutes: 0,
  snapshotHandlingMethod: 3,
  immediateRingNotificationWithoutSnapshot: false,
  delayCameraSnapshot: false,
  indoorChimeButton: false,
};