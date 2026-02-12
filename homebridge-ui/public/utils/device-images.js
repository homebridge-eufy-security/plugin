/**
 * Device type → image filename mapping.
 * Ported from src/configui/app/util/deviceToImagesMap.ts
 */
// eslint-disable-next-line no-unused-vars
const DeviceImages = {
  getImage(deviceType) {
    switch (deviceType) {
      case 0: return 'homebase2_large.png';
      case 1: case 4: return 'eufycam_large.jpg';
      case 2: return 'sensor_large.png';
      case 3: return 'floodlight_large.jpg';
      case 5: return 'wireddoorbell2k_large.jpg';
      case 7: case 16: return 'batterydoorbell2k_large.png';
      case 8: return 'eufycam2c_large.jpg';
      case 9: return 'eufycam2_large.png';
      case 10: return 'motionsensor_large.png';
      case 11: return 'keypad_large.png';
      case 14: return 'eufycam2pro_large.jpg';
      case 15: return 'eufycam2cpro_large.jpg';
      case 18: return 'homebase3_large.png';
      case 19: return 'eufycam3_large.jpg';
      case 23: return 'eufycam3c_large.jpg';
      case 24: return 'eufycame330_large.jpg';
      case 25: return 'minibase_chime_T8023_large.jpg';
      case 26: return 'eufycam3pro_large.png';
      case 28: return 'homebasemini_large.jpg';
      case 30: return 'indoorcamc120_large.png';
      case 31: case 35: return 'indoorcamp24_large.png';
      case 32: case 33: return 'solocame20_large.jpg';
      case 34: return 'soloindoorcamc24_large.jpg';
      case 37: return 'floodlight_large.jpg';
      case 38: return 'floodlight2pro_large.jpg';
      case 39: return 'floodlight_large.jpg';
      case 44: case 46: return 'solooutdoorcamc22_large.png';
      case 45: return 'solooutdoorcamc24_large.jpg';
      case 47: return 'floodlightcame340_large.jpg';
      case 48: return 'solocams340_large.png';
      case 49: return 'solocame40_large.jpg';
      case 50: return 'smartlock_touch_t8510_large.jpg';
      case 51: return 'smartlock_touch_and_wifi_t8520_large.jpg';
      case 52: case 53: return 'smartlock_t8500_large.jpg';
      case 54: return 'smartlock_t8503_large.jpg';
      case 55: return 'smartlock_video_t8530_large.png';
      case 56: case 57: return 'smartlock_t8510P_t8520P_large.jpg';
      case 58: return 'smartlock_t8504_large.jpg';
      case 60: return 'solocaml20_large.jpg';
      case 61: return 'solooutdoorcamc24_large.jpg';
      case 62: return 'solocams40_large.jpg';
      case 63: return 'solocams220_large.jpg';
      case 64: return 'solocamc210_large.jpg';
      case 87: return 'floodlight2_large.jpg';
      case 88: return 'solocame30_large.png';
      case 90: return 'smartdrop_t8790_large.jpg';
      case 91: return 'batterydoorbell2kdual_large.jpg';
      case 93: return 'wireddoorbelldual_large.jpg';
      case 94: return 'batterydoorbell_e340_large.jpg';
      case 95: return 'BATTERY_DOORBELL_C30.webp';
      case 96: return 'BATTERY_DOORBELL_C31.png';
      case 100: return 'indoorcammini_large.jpg';
      case 104: return 'indoorcams350_large.jpg';
      case 105: return 'indoorcamE30_large.png';
      case 101: case 102:
      case 131: case 132: case 133:
        return 'garage_camera_t8452_large.jpg';
      case 110: return '4g_lte_starlight_large.jpg';
      case 126: return 'sensor_large.png';
      case 140: return 'smartsafe_s10_t7400_large.jpg';
      case 141: return 'smartsafe_s12_t7401_large.jpg';
      case 142: case 143: return 'smartsafe_s10_t7400_large.jpg';
      case 151: return 'walllight_s100_large.jpg';
      case 157: return 'smarttrack_link_t87B0_large.jpg';
      case 159: return 'smarttrack_card_t87B2_large.jpg';
      case 180: return 'smartlock_touch_and_wifi_t8502_large.jpg';
      case 184: return 'smartlock_touch_and_wifi_t8506_large.jpg';
      case 10005: return 'walllight_s120_large.jpg';
      case 10008: return 'indoorcamC220_large.png';
      case 10009: return 'indoorcamC210_large.png';
      case 10010: return 'indoorcamC220_large.png';
      case 10035: return 'solocamc35_large.png';
      default: return 'unknown.png';
    }
  },

  /** Returns full relative path to device image */
  getPath(deviceType) {
    return 'assets/devices/' + this.getImage(deviceType);
  },
};
