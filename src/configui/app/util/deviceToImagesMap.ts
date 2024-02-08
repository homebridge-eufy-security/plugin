import { DeviceType } from './eufy-security-client.utils';

export const DeviceImage = new Map<DeviceType, { image: string; padding: string }>([
  [DeviceType.STATION, { image: 'homebase2_large.jpg', padding: '0px' }],
  [DeviceType.HB3, { image: 'homebase3_large.jpg', padding: '0px' }],
  [DeviceType.CAMERA, { image: 'eufycam_large.jpg', padding: '0px' }],
  [DeviceType.SENSOR, { image: 'sensor_large.jpg', padding: '0px' }],
  [DeviceType.FLOODLIGHT, { image: 'floodlight_large.jpg', padding: '0px' }],
  [DeviceType.CAMERA_E, { image: 'eufycam_large.jpg', padding: '0px' }],
  [DeviceType.DOORBELL, { image: 'batterydoorbell2k_large.jpg', padding: '0px' }],
  [DeviceType.BATTERY_DOORBELL, { image: 'batterydoorbell2k_large.jpg', padding: '0px' }],
  [DeviceType.CAMERA2C, { image: 'eufycam2c_large.jpg', padding: '0px' }],
  [DeviceType.CAMERA2, { image: 'eufycam2_large.jpg', padding: '0px' }],
  [DeviceType.CAMERA3C, { image: 'eufycam3c_large.jpg', padding: '0px' }],
  [DeviceType.CAMERA3, { image: 'eufycam3_large.jpg', padding: '0px' }],
  [DeviceType.MOTION_SENSOR, { image: 'motionsensor_large.jpg', padding: '0px' }],
  [DeviceType.KEYPAD, { image: 'keypad_large.jpg', padding: '0px' }],
  [DeviceType.CAMERA2_PRO, { image: 'eufycam2pro_large.jpg', padding: '0px' }],
  [DeviceType.CAMERA2C_PRO, { image: 'eufycam2cpro_large.jpg', padding: '0px' }],
  [DeviceType.BATTERY_DOORBELL_2, { image: 'batterydoorbell2k_large.jpg', padding: '0px' }],
  [DeviceType.INDOOR_CAMERA, { image: 'indoorcammini_large.jpg', padding: '0px' }],
  [DeviceType.INDOOR_PT_CAMERA, { image: 'indoorcamp24_large.jpg', padding: '0px' }],
  [DeviceType.SOLO_CAMERA, { image: 'solocame20_large.jpg', padding: '0px' }],
  [DeviceType.SOLO_CAMERA_SOLAR, { image: 'solocams220.png', padding: '0px' }],
  [DeviceType.SOLO_CAMERA_PRO, { image: 'solocame20_large.jpg', padding: '0px' }],
  [DeviceType.INDOOR_CAMERA_1080, { image: 'soloindoorcamc24_large.jpg', padding: '10px' }],
  [DeviceType.INDOOR_PT_CAMERA_1080, { image: 'indoorcamp24_large.jpg', padding: '0px' }],
  [DeviceType.FLOODLIGHT_CAMERA_8422, { image: 'floodlight_large.jpg', padding: '0px' }],
  [DeviceType.FLOODLIGHT_CAMERA_8423, { image: 'floodlight2pro_large.jpg', padding: '0px' }],
  [DeviceType.FLOODLIGHT_CAMERA_8424, { image: 'floodlight2_large.jpg', padding: '0px' }],
  [DeviceType.INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT, { image: 'soloindoorcamc24_large.jpg', padding: '10px' }],
  [DeviceType.INDOOR_OUTDOOR_CAMERA_2K, { image: 'soloindoorcamc24_large.jpg', padding: '10px' }],
  [DeviceType.INDOOR_OUTDOOR_CAMERA_1080P, { image: 'soloindoorcamc24_large.jpg', padding: '10px' }],
  [DeviceType.LOCK_BLE, { image: 'smartlock_touch_t8510_large.jpg', padding: '0px' }],
  [DeviceType.LOCK_WIFI, { image: 'smartlock_touch_t8510_large.jpg', padding: '0px' }],
  [DeviceType.LOCK_BLE_NO_FINGER, { image: 'smartlock_t8500_large.jpg', padding: '0px' }],
  [DeviceType.LOCK_WIFI_NO_FINGER, { image: 'smartlock_t8500_large.jpg', padding: '0px' }],
  [DeviceType.LOCK_8503, { image: 'smartlock_t8500_large.jpg', padding: '0px' }],
  [DeviceType.LOCK_8530, { image: 'smartlock_t8500_large.jpg', padding: '0px' }],
  [DeviceType.LOCK_85A3, { image: 'smartlock_t8500_large.jpg', padding: '0px' }],
  [DeviceType.LOCK_8592, { image: 'smartlock_t8500_large.jpg', padding: '0px' }],
  [DeviceType.LOCK_8504, { image: 'smartlock_t8500_large.jpg', padding: '0px' }],
  [DeviceType.SOLO_CAMERA_SPOTLIGHT_1080, { image: 'solooutdoorcamc24_large.jpg', padding: '15px' }],
  [DeviceType.SOLO_CAMERA_SPOTLIGHT_2K, { image: 'solooutdoorcamc24_large.jpg', padding: '15px' }],
  [DeviceType.SOLO_CAMERA_SPOTLIGHT_SOLAR, { image: 'solocams40_large.jpg', padding: '10px' }],
  [DeviceType.SMART_DROP, { image: 'smartdrop_t8790_large.jpg', padding: '20px' }],
  [DeviceType.BATTERY_DOORBELL_PLUS, { image: 'batterydoorbell2k_large.jpg', padding: '0px' }],
  [DeviceType.DOORBELL_SOLO, { image: 'wireddoorbelldual_large.jpg', padding: '0px' }],
  [DeviceType.INDOOR_COST_DOWN_CAMERA, { image: 'indoorcammini_large.jpg', padding: '0px' }],
  [DeviceType.CAMERA_GUN, { image: 'unknown.png', padding: '20px' }],
  [DeviceType.CAMERA_SNAIL, { image: 'unknown.png', padding: '20px' }],
  [DeviceType.CAMERA_FG, { image: '4g_lte_starlight_large.jpg', padding: '20px' }],
  [DeviceType.SMART_SAFE_7400, { image: 'smartsafe_s10_t7400_large.jpg', padding: '20px' }],
  [DeviceType.SMART_SAFE_7401, { image: 'smartsafe_s12_t7401_large.jpg', padding: '20px' }],
  [DeviceType.SMART_SAFE_7402, { image: 'unknown.png', padding: '20px' }],
  [DeviceType.SMART_SAFE_7403, { image: 'unknown.png', padding: '20px' }],
  [DeviceType.WALL_LIGHT_CAM, { image: 'walllight_s100_large.jpg', padding: '20px' }],
  [DeviceType.SMART_TRACK_LINK, { image: 'unknown.png', padding: '20px' }],
  [DeviceType.SMART_TRACK_CARD, { image: 'unknown.png', padding: '20px' }],
  [DeviceType.LOCK_8502, { image: 'unknown.png', padding: '20px' }],
  [DeviceType.LOCK_8506, { image: 'unknown.png', padding: '20px' }],
  [DeviceType.WALL_LIGHT_CAM_81A0, { image: 'walllight_s100_large', padding: '20px' }],
  [DeviceType.CAMERA_GARAGE_T8452, { image: 'garage_camera_t8452_small.jpg', padding: '20px' }],
  [DeviceType.CAMERA_GARAGE_T8453, { image: 'unknown.png', padding: '20px' }],
  [DeviceType.CAMERA_GARAGE_T8453_COMMON, { image: 'unknown.png', padding: '20px' }],
]);
