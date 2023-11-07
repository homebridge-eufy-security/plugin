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
  uniqueId: string;
  displayName: string;
  type: number;
  typename: string;
  station: boolean;
  ignored?: boolean;
  cachedName?: string;
  isCamera?: boolean;
  isDoorbell?: boolean;
  supportsRTSP?: boolean;
  supportsTalkback?: boolean;
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