import { CachedAccessory, PluginConfig } from '@homebridge/plugin-ui-utils/dist/ui.interface';
import { Accessory } from '../../app/accessory';

export const DEFAULT_CACHED_ACCESSORIES: CachedAccessory[] = [
  {
    plugin: 'homebridge-eufy-security',
    platform: 'EufySecurity',
    context: {
      device: {
        displayName: 'Homebase',
        station: true,
        type: 0,
        uniqueId: 'T8010P111111111A',
      },
    },
    displayName: 'Homebase',
    UUID: '',
    category: '1',
    services: [],
  },
  {
    plugin: 'homebridge-eufy-security',
    platform: 'EufySecurity',
    context: {
      device: {
        displayName: 'Homebase Station Entry',
        station: true,
        type: 0,
        uniqueId: 'T8010P111111111BA',
      },
    },
    displayName: 'Homebase',
    UUID: '',
    category: '1',
    services: [],
  },
  {
    plugin: 'homebridge-eufy-security',
    platform: 'EufySecurity',
    context: {
      device: {
        displayName: 'Homebase 2 Living Room',
        station: true,
        type: 0,
        uniqueId: 'T8010P111111111C',
      },
    },
    displayName: 'Homebase',
    UUID: '',
    category: '1',
    services: [],
  },
  {
    plugin: 'homebridge-eufy-security',
    platform: 'EufySecurity',
    context: {
      device: {
        displayName: 'Doorbell',
        station: false,
        type: 7,
        uniqueId: 'T8210P1111111111',
      },
    },
    displayName: 'Doorbell',
    UUID: '',
    category: '1',
    services: [],
  },
  {
    plugin: 'homebridge-eufy-security',
    platform: 'EufySecurity',
    context: {
      device: {
        displayName: 'Doorbell',
        station: false,
        type: 7,
        uniqueId: 'T8210P1111111112',
      },
    },
    displayName: 'Doorbell',
    UUID: '',
    category: '1',
    services: [],
  },
  {
    plugin: 'homebridge-eufy-security',
    platform: 'EufySecurity',
    context: {
      device: {
        displayName: 'Doorbell',
        station: false,
        type: 7,
        uniqueId: 'T8210P1111111113',
      },
    },
    displayName: 'Doorbell',
    UUID: '',
    category: '1',
    services: [],
  },
];

export const DEFAULT_STORED_ACCESSORIES: Accessory[] = [
  {
    uniqueId: 'T8010P111111111A',
    displayName: 'Homebase',
    station: true,
    type: 0,
  },
  {
    uniqueId: 'T8010P111111111B',
    displayName: 'Homebase Station Entry',
    station: true,
    type: 0,
  },
  {
    uniqueId: 'T8010P111111111C',
    displayName: 'Homebase 2 Living Room',
    station: true,
    type: 0,
  },
  {
    uniqueId: 'T8210P1111111111',
    displayName: 'Doorbell',
    station: false,
    type: 7,
  },
  {
    uniqueId: 'T8210P1111111112',
    displayName: 'Floodlight',
    station: false,
    type: 3,
  },
  {
    uniqueId: 'T8210P1111111113',
    displayName: 'Doorbell',
    station: false,
    type: 7,
  },
];

export const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  platform: 'EufySecurity',
  username: 'totally@random.mail',
  password: 'verysecretpassword',
  country: 'UA',
  ignoreStations: ['T8010P111111111B'],
  ignoreDevices: [],
  pollingIntervalMinutes: 10,
  hkHome: 1,
  hkAway: 0,
  hkNight: 3,
  hkOff: 63,
  enableDetailedLogging: true,
  CameraMaxLivestreamDuration: 60,
  cleanCache: true,
  cameras: [
    {
      serialNumber: 'T8210P1111111111',
      enableCamera: true,
      enableButton: true,
      motionButton: true,
      rtsp: false,
      unbridge: false,
      forcerefreshsnap: false,
      useCachedLocalLivestream: true,
      useEnhancedSnapshotBehaviour: true,
      snapshotHandlingMethod: 2,
      immediateRingNotificationWithoutSnapshot: true,
      delayCameraSnapshot: false,
      videoConfig: {
        audio: true,
        debug: true,
      },
    },
  ],
};

export const CAPTCHA_DATA =
  // eslint-disable-next-line max-len
  'data:image/gif;base64,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';
