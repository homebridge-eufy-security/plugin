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