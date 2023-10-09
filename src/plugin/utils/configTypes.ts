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
  videoConfigEna: boolean;
  enableCamera: boolean;
  forcerefreshsnap: boolean;
  refreshSnapshotIntervalMinutes?: number;
  snapshotHandlingMethod?: number;
  immediateRingNotificationWithoutSnapshot?: boolean;
  delayCameraSnapshot?:boolean;
  talkback?: boolean;
  talkbackChannels?: number;
  hsv?: boolean;
  hsvRecordingDuration?: number;
  hsvConfig?: VideoConfig;
  indoorChimeButton?: boolean;
};

export const DEFAULT_CAMERACONFIG_VALUES = {
  enableButton: true,
  motionButton: true,
  lightButton: true,
  talkback: false,
  talkbackChannels: 1,
  hsv: true,
  hsvRecordingDuration: 90,
  rtsp: false,
  enableCamera: true,
  forcerefreshsnap: false,
  useCachedLocalLivestream: false,
  useEnhancedSnapshotBehaviour: true,
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

export type StationConfig = {
  serialNumber?: string;
  hkHome: number;
  hkAway: number;
  hkNight: number;
  hkOff: number;
  manualTriggerModes: number[];
  manualAlarmSeconds: number;
};