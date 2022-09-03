import { Camera, PropertyName } from 'eufy-security-client';

import { CameraConfig } from './configTypes';
import { Logger } from './logger';

export const is_rtsp_ready = function(device: Camera, cameraConfig: CameraConfig, log: Logger): boolean {

  log.debug(device.getName(), 'RTSP rtspStream:' + JSON.stringify(device.hasProperty('rtspStream')));
  if (!device.hasProperty('rtspStream')) {
    log.debug(device.getName(), 'Looks like not compatible with RTSP');
    return false;
  }

  log.debug(device.getName(), 'RTSP cameraConfig: ' + JSON.stringify(cameraConfig.rtsp));
  if (!cameraConfig.rtsp) {
    log.debug(device.getName(), 'Looks like RTSP is not enabled on camera config');
    return false;
  }

  log.debug(device.getName(), 'RTSP ' + JSON.stringify(device.getPropertyValue(PropertyName.DeviceRTSPStream)));
  if (!device.getPropertyValue(PropertyName.DeviceRTSPStream)) {
    log.debug(device.getName(), ': RTSP capabilities not enabled. You will need to do it manually!');
    return false;
  }

  log.debug(device.getName(), 'RTSP ' + JSON.stringify(device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl)));
  if (device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl) === '') {
    log.debug(device.getName(), ': RTSP URL is unknow');
    return false;
  }

  return true;
};