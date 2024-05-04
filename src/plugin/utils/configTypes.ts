export type CameraConfig = {
  name?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  firmwareRevision?: string;
  motion?: boolean;
  doorbell?: boolean;
  switches?: boolean;
  motionTimeout?: number;
  motionDoorbell?: boolean;
  videoConfig?: VideoConfig;
  enableButton: boolean;
  motionButton: boolean;
  lightButton: boolean;
  rtsp: boolean;
  enableCamera: boolean;
  refreshSnapshotIntervalMinutes?: number;
  snapshotHandlingMethod?: number;
  immediateRingNotificationWithoutSnapshot?: boolean;
  delayCameraSnapshot?: boolean;
  talkback?: boolean;
  talkbackChannels?: number;
  hsv?: boolean;
  hsvRecordingDuration?: number;
  indoorChimeButton?: boolean;
};

export const DEFAULT_CAMERACONFIG_VALUES: CameraConfig = {
  name: '',
  manufacturer: '',
  model: '',
  serialNumber: '',
  firmwareRevision: '',
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

export type VideoConfig = {
  source?: string;
  stillImageSource?: string;
  returnAudioTarget?: string;
  analyzeDuration?: number;
  probeSize?: number;
  maxStreams?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxFPS?: number;
  maxBitrate?: number;
  readRate?: boolean;
  vcodec?: string;
  acodec?: string;
  packetSize?: number;
  stimeout?: number;
  videoFilter?: string;
  encoderOptions?: string;
  audio?: boolean;
  audioSampleRate?: number;
  audioBitrate?: number;
  acodecHK?: string;
  acodecOptions?: string;
  debug?: boolean;
  debugReturn?: boolean;
  useSeparateProcesses?: boolean;
  crop?: boolean;
  videoProcessor?: string;
};

export const DEFAULT_VIDEOCONFIG_VALUES: VideoConfig = {
  probeSize: 16384,
  audio: true,
  vcodec: 'copy',
  acodec: 'copy',
};

export type StationConfig = {
  serialNumber?: string;
  hkHome: number;
  hkAway: number;
  hkNight: number;
  hkOff: number;
  manualTriggerModes: number[];
  manualAlarmSeconds: number;
};