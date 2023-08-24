export enum DeviceType {
  //List retrieved from com.oceanwing.battery.cam.binder.model.QueryDeviceData
  STATION = 0,
  CAMERA = 1,
  SENSOR = 2,
  FLOODLIGHT = 3,
  CAMERA_E = 4,
  DOORBELL = 5,
  BATTERY_DOORBELL = 7,
  CAMERA2C = 8,
  CAMERA2 = 9,
  MOTION_SENSOR = 10,
  KEYPAD = 11,
  CAMERA2_PRO = 14,
  CAMERA2C_PRO = 15,
  BATTERY_DOORBELL_2 = 16,
  HB3 = 18,
  CAMERA3 = 19,
  CAMERA3C = 23,
  INDOOR_CAMERA = 30,
  INDOOR_PT_CAMERA = 31,
  SOLO_CAMERA = 32,
  SOLO_CAMERA_PRO = 33,
  INDOOR_CAMERA_1080 = 34,
  INDOOR_PT_CAMERA_1080 = 35,
  FLOODLIGHT_CAMERA_8422 = 37,
  FLOODLIGHT_CAMERA_8423 = 38,
  FLOODLIGHT_CAMERA_8424 = 39,
  INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT = 44,
  INDOOR_OUTDOOR_CAMERA_2K = 45,
  INDOOR_OUTDOOR_CAMERA_1080P = 46,
  LOCK_BLE = 50,
  LOCK_WIFI = 51,
  LOCK_BLE_NO_FINGER = 52,
  LOCK_WIFI_NO_FINGER = 53,
  LOCK_8503 = 54, //Smart Lock R10
  LOCK_8530 = 55,
  LOCK_85A3 = 56,
  LOCK_8592 = 57,
  LOCK_8504 = 58, //Smart Lock R20
  SOLO_CAMERA_SPOTLIGHT_1080 = 60,
  SOLO_CAMERA_SPOTLIGHT_2K = 61,
  SOLO_CAMERA_SPOTLIGHT_SOLAR = 62,
  SMART_DROP = 90,
  BATTERY_DOORBELL_PLUS = 91,
  DOORBELL_SOLO = 93,
  INDOOR_COST_DOWN_CAMERA = 100,
  CAMERA_GUN = 101,
  CAMERA_SNAIL = 102,
  CAMERA_FG = 110, //T8150
  CAMERA_GARAGE_T8453_COMMON = 131,
  CAMERA_GARAGE_T8452 = 132,
  CAMERA_GARAGE_T8453 = 133,
  SMART_SAFE_7400 = 140,
  SMART_SAFE_7401 = 141,
  SMART_SAFE_7402 = 142,
  SMART_SAFE_7403 = 143,
  WALL_LIGHT_CAM = 151,
  SMART_TRACK_LINK = 157, //T87B0
  SMART_TRACK_CARD = 159, //T87B2
  LOCK_8502 = 180,
  LOCK_8506 = 181,
  WALL_LIGHT_CAM_81A0 = 10005,
}

export class Device {
  static isDoorbell(type: number): boolean {
    if (
      type === DeviceType.DOORBELL ||
      type === DeviceType.BATTERY_DOORBELL ||
      type === DeviceType.BATTERY_DOORBELL_2 ||
      type === DeviceType.BATTERY_DOORBELL_PLUS ||
      type === DeviceType.DOORBELL_SOLO
    ) {
      return true;
    }
    return false;
  }

  static isBatteryDoorbell(type: number): boolean {
    if (type === DeviceType.BATTERY_DOORBELL ||
        type === DeviceType.BATTERY_DOORBELL_2 ||
        type === DeviceType.BATTERY_DOORBELL_PLUS
    ) {
      return true;
    }
    return false;
  }

  static isWiredDoorbell(type: number): boolean {
    if (type === DeviceType.DOORBELL) {
      return true;
    }
    return false;
  }

  static isCamera(type: number): boolean {
    if (
      type === DeviceType.CAMERA ||
      type === DeviceType.CAMERA2 ||
      type === DeviceType.CAMERA_E ||
      type === DeviceType.CAMERA2C ||
      type === DeviceType.CAMERA3 ||
      type === DeviceType.CAMERA3C ||
      type === DeviceType.INDOOR_CAMERA ||
      type === DeviceType.INDOOR_PT_CAMERA ||
      type === DeviceType.FLOODLIGHT ||
      type === DeviceType.DOORBELL ||
      type === DeviceType.BATTERY_DOORBELL ||
      type === DeviceType.BATTERY_DOORBELL_2 ||
      type === DeviceType.BATTERY_DOORBELL_PLUS ||
      type === DeviceType.DOORBELL_SOLO ||
      type === DeviceType.CAMERA2C_PRO ||
      type === DeviceType.CAMERA2_PRO ||
      type === DeviceType.CAMERA3 ||
      type === DeviceType.CAMERA3C ||
      type === DeviceType.INDOOR_CAMERA_1080 ||
      type === DeviceType.INDOOR_PT_CAMERA_1080 ||
      type === DeviceType.SOLO_CAMERA ||
      type === DeviceType.SOLO_CAMERA_PRO ||
      type === DeviceType.SOLO_CAMERA_SPOTLIGHT_1080 ||
      type === DeviceType.SOLO_CAMERA_SPOTLIGHT_2K ||
      type === DeviceType.SOLO_CAMERA_SPOTLIGHT_SOLAR ||
      type === DeviceType.INDOOR_OUTDOOR_CAMERA_1080P ||
      type === DeviceType.INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT ||
      type === DeviceType.INDOOR_OUTDOOR_CAMERA_2K ||
      type === DeviceType.INDOOR_COST_DOWN_CAMERA ||
      type === DeviceType.FLOODLIGHT_CAMERA_8422 ||
      type === DeviceType.FLOODLIGHT_CAMERA_8423 ||
      type === DeviceType.FLOODLIGHT_CAMERA_8424 ||
      type === DeviceType.WALL_LIGHT_CAM ||
      type === DeviceType.WALL_LIGHT_CAM_81A0 ||
      type === DeviceType.CAMERA_GARAGE_T8453_COMMON ||
      type === DeviceType.CAMERA_GARAGE_T8453 ||
      type === DeviceType.CAMERA_GARAGE_T8452 ||
      type === DeviceType.CAMERA_FG
    ) {
      return true;
    }
    return false;
  }

  static supportsRTSP(type: number): boolean {
    return (
      type === DeviceType.CAMERA ||
      type === DeviceType.CAMERA2 ||
      type === DeviceType.CAMERA2C ||
      type === DeviceType.CAMERA2C_PRO ||
      type === DeviceType.CAMERA3 ||
      type === DeviceType.CAMERA3C ||
      type === DeviceType.CAMERA_E ||
      type === DeviceType.INDOOR_CAMERA ||
      type === DeviceType.INDOOR_CAMERA_1080 ||
      type === DeviceType.INDOOR_OUTDOOR_CAMERA_1080P ||
      type === DeviceType.INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT ||
      type === DeviceType.INDOOR_OUTDOOR_CAMERA_2K ||
      type === DeviceType.INDOOR_PT_CAMERA ||
      type === DeviceType.INDOOR_PT_CAMERA_1080 ||
      type === DeviceType.INDOOR_COST_DOWN_CAMERA ||
      type === DeviceType.FLOODLIGHT_CAMERA_8423 ||
      type === DeviceType.CAMERA_GARAGE_T8453_COMMON ||
      type === DeviceType.CAMERA_GARAGE_T8453 ||
      type === DeviceType.CAMERA_GARAGE_T8452 ||
      type === DeviceType.CAMERA_FG
    );
  }

  static supportsTalkback(type: number): boolean {
    return (
      type === DeviceType.CAMERA2 ||
      type === DeviceType.CAMERA2C ||
      type === DeviceType.CAMERA2C_PRO ||
      type === DeviceType.CAMERA2_PRO ||
      type === DeviceType.CAMERA3 ||
      type === DeviceType.CAMERA3C ||
      type === DeviceType.DOORBELL ||
      type === DeviceType.BATTERY_DOORBELL ||
      type === DeviceType.BATTERY_DOORBELL_2 ||
      type === DeviceType.BATTERY_DOORBELL_PLUS ||
      type === DeviceType.DOORBELL_SOLO ||
      type === DeviceType.INDOOR_CAMERA ||
      type === DeviceType.INDOOR_CAMERA_1080 ||
      type === DeviceType.INDOOR_OUTDOOR_CAMERA_1080P ||
      type === DeviceType.INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT ||
      type === DeviceType.INDOOR_OUTDOOR_CAMERA_2K ||
      type === DeviceType.INDOOR_PT_CAMERA ||
      type === DeviceType.INDOOR_PT_CAMERA_1080 ||
      type === DeviceType.INDOOR_COST_DOWN_CAMERA ||
      type === DeviceType.SOLO_CAMERA ||
      type === DeviceType.SOLO_CAMERA_PRO ||
      type === DeviceType.SOLO_CAMERA_SPOTLIGHT_1080 ||
      type === DeviceType.SOLO_CAMERA_SPOTLIGHT_2K ||
      type === DeviceType.SOLO_CAMERA_SPOTLIGHT_SOLAR ||
      type === DeviceType.FLOODLIGHT ||
      type === DeviceType.FLOODLIGHT_CAMERA_8422 ||
      type === DeviceType.FLOODLIGHT_CAMERA_8423 ||
      type === DeviceType.FLOODLIGHT_CAMERA_8424 ||
      type === DeviceType.WALL_LIGHT_CAM ||
      type === DeviceType.WALL_LIGHT_CAM_81A0 ||
      type === DeviceType.CAMERA_GARAGE_T8453_COMMON ||
      type === DeviceType.CAMERA_GARAGE_T8453 ||
      type === DeviceType.CAMERA_GARAGE_T8452 ||
      type === DeviceType.CAMERA_FG
    );
  }
}

export enum ChargingStatus {
  CHARGING = 1,
  UNPLUGGED = 2,
  PLUGGED = 3,
  SOLAR_CHARGING = 4,
}