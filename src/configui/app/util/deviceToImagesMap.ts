// Define an array of device type IDs based on the updated DeviceType enum values
const deviceTypeIds = [
  0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 14, 15, 16, 18, 19, 23, 24, 25, 30, 31, 32, 33, 34,
  35, 37, 38, 39, 44, 45, 46, 47, 48, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62, 63,
  64, 90, 91, 93, 94, 100, 101, 102, 104, 110, 131, 132, 133, 140, 141, 142, 143, 151,
  157, 159, 180, 184, 10005,
];

// Function to get the image based on the device type number
export function getImageForDeviceType(deviceType: number): string {
  switch (deviceType) {
    case 0: // STATION
      return 'homebase2_large.png';
    case 1: // CAMERA
    case 4: // CAMERA_E
      return 'eufycam_large.jpg';
    case 2: // SENSOR
      return 'sensor_large.png';
    case 3: // FLOODLIGHT
      return 'floodlight_large.jpg';
    case 5: // DOORBELL
    case 7: // BATTERY_DOORBELL
    case 16: // BATTERY_DOORBELL_2
    case 91: // BATTERY_DOORBELL_PLUS
      return 'batterydoorbell2k_large.png';
    case 8: // CAMERA2C
      return 'eufycam2c_large.jpg';
    case 9: // CAMERA2
    case 14: // CAMERA2_PRO
    case 15: // CAMERA2C_PRO
      return 'eufycam2_large.png';
    case 10: // MOTION_SENSOR
      return 'motionsensor_large.png';
    case 11: // KEYPAD
      return 'keypad_large.png';
    case 18: // HB3
      return 'homebase3_large.jpg';
    case 19: // CAMERA3
      return 'eufycam3_large.jpg';
    case 23: // CAMERA3C
      return 'eufycam3c_large.jpg';
    case 24: // PROFESSIONAL_247
      return 'eufycame330_large.jpg';
    case 25: // MINIBASE_CHIME
      return 'minibase_chime_T8023_large.jpg';
    case 30: // INDOOR_CAMERA
      return 'indoorcamc120_large.png';
    case 100: // INDOOR_COST_DOWN_CAMERA
      return 'indoorcammini_large.jpg';
    case 31: // INDOOR_PT_CAMERA
    case 35: // INDOOR_PT_CAMERA_1080
      return 'indoorcamp24_large.png';
    case 32: // SOLO_CAMERA
    case 33: // SOLO_CAMERA_PRO
      return 'solocame20_large.jpg';
    case 34: // INDOOR_CAMERA_1080
      return 'soloindoorcamc24_large.jpg';
    case 37: // FLOODLIGHT_CAMERA_8422
    case 39: // FLOODLIGHT_CAMERA_8424
      return 'floodlight_large.jpg';
    case 38: // FLOODLIGHT_CAMERA_8423
      return 'floodlight2pro_large.jpg';
    case 44: // INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT
    case 46: // INDOOR_OUTDOOR_CAMERA_1080P
      return 'solooutdoorcamc22_large.png';
    case 45: // INDOOR_OUTDOOR_CAMERA_2K
      return 'solooutdoorcamc24_large.jpg';
    case 47: // FLOODLIGHT_CAMERA_8425
      return 'floodlightcame340_large.jpg';
    case 48: // OUTDOOR_PT_CAMERA
      return 'solocams340_large.png';
    case 50: // LOCK_BLE
    case 51: // LOCK_WIFI
    case 52: // LOCK_BLE_NO_FINGER
    case 53: // LOCK_WIFI_NO_FINGER
    case 54: // LOCK_8503
    case 55: // LOCK_8530
    case 56: // LOCK_85A3
    case 57: // LOCK_8592
    case 58: // LOCK_8504
    case 180: // LOCK_8502
    case 184: // LOCK_8506
      return 'smartlock_t8500_large.jpg';
    case 60: // SOLO_CAMERA_SPOTLIGHT_1080
    case 61: // SOLO_CAMERA_SPOTLIGHT_2K
    case 62: // SOLO_CAMERA_SPOTLIGHT_SOLAR
      return 'solooutdoorcamc24_large.jpg';
    case 63: // SOLO_CAMERA_SOLAR
      return 'solocams220_large.jpg';
    case 64: // SOLO_CAMERA_C210
      return 'solocamc210_large.jpg';
    case 90: // SMART_DROP
      return 'smartdrop_t8790_large.jpg';
    case 93: // DOORBELL_SOLO
      return 'wireddoorbelldual_large.jpg';
    case 94: // BATTERY_DOORBELL_PLUS_E340
      return 'batterydoorbell_e340_large.jpg';
    case 104: // INDOOR_PT_CAMERA_S350
      return 'indoorcams350_large.jpg';
    case 101: // CAMERA_GUN
    case 102: // CAMERA_SNAIL
    case 110: // CAMERA_FG
    case 131: // CAMERA_GARAGE_T8453_COMMON
    case 132: // CAMERA_GARAGE_T8452
    case 133: // CAMERA_GARAGE_T8453
      return 'garage_camera_t8452_large.jpg';
    case 140: // SMART_SAFE_7400
      return 'smartsafe_s10_t7400_large.jpg';
    case 141: // SMART_SAFE_7401
      return 'smartsafe_s12_t7401_large.jpg';
    case 142: // SMART_SAFE_7402
    case 143: // SMART_SAFE_7403
      return 'smartsafe_s10_t7400_large.jpg';
    case 151: // WALL_LIGHT_CAM
      return 'walllight_s100_large.jpg';
    case 10005: // WALL_LIGHT_CAM_81A0
      return 'walllight_s120_large.jpg';
    case 157: // SMART_TRACK_LINK
      return 'smarttrack_link_t87B0_large.jpg';
    case 159: // SMART_TRACK_CARD
      return 'smarttrack_card_t87B2_large.jpg';
    // The following devices are not matched to an image
    // and will fall back to the default case.
    default:
      return 'unknown.png';
  }
}

// Generate DeviceImage map using the getImageForDeviceType function
export const DeviceImage = new Map<number, { image: string }>(
  deviceTypeIds.map((deviceTypeId) => [
    deviceTypeId,
    { image: getImageForDeviceType(deviceTypeId) },
  ]),
);