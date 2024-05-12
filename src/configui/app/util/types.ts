export type PropertyValue = number | boolean | string | object;

export interface PropertyValues {
    [index: string]: PropertyValue;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Credentials = {
  username: string;
  password: string;
  country: string;
  deviceName: string;
};

export enum LoginFailReason {
  UNKNOWN = 0,
  CAPTCHA = 1,
  TFA = 2,
  TIMEOUT = 3,
}

export type LoginResult = {
  success: boolean;
  failReason?: LoginFailReason;
  data?: any;
};

export type Accessory = {
  stations?: L_Station[];
};

export type L_Station = {
  uniqueId: string;
  displayName: string;
  type: number;
  typename: string;
  ignored?: boolean;
  devices: L_Device[];
  disabled: boolean;
};

export type L_Device = {
  uniqueId: string;
  displayName: string;
  type: number;
  typename: string;
  standalone: boolean;
  ignored?: boolean;
  isCamera: boolean;
  hasBattery?: boolean;
  chargingStatus?: number;
  isDoorbell: boolean;
  isKeypad: boolean;
  supportsRTSP?: boolean;
  supportsTalkback?: boolean;
  DeviceEnabled: boolean;
  DeviceMotionDetection: boolean;
  DeviceLight: boolean;
  DeviceChimeIndoor: boolean;
  disabled: boolean;
  properties: PropertyValues;
};

export enum ChargingType {
  CHARGING = 1,
  UNPLUGGED = 2,
  PLUGGED = 3,
  SOLAR_CHARGING = 4
}

export type Country = {
  short: string;
  long: string;
};