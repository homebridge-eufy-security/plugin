import { DeviceProperties, DeviceType, PropertyName, DeviceRTSPStreamProperty, DeviceRTSPStreamUrlProperty } from 'eufy-security-client';

export const initializeExperimentalMode = () => {
  addRTSPPropertiesToAllDevices();
}

const addRTSPPropertiesToAllDevices = () => {
  for (const deviceType in DeviceType) {
    if (isNaN(Number(deviceType))) {
      continue;
    }
    addRTSPPropertiesToDevice(Number(deviceType));
  }
};

const addRTSPPropertiesToDevice = (deviceType: number) => {
  if (!DeviceProperties[deviceType][PropertyName.DeviceRTSPStream]) {
    DeviceProperties[deviceType] = {
      ...DeviceProperties[deviceType],
      [PropertyName.DeviceRTSPStream]: DeviceRTSPStreamProperty,
    };
  }

  if (!DeviceProperties[deviceType][PropertyName.DeviceRTSPStreamUrl]) {
    DeviceProperties[deviceType] = {
      ...DeviceProperties[deviceType],
      [PropertyName.DeviceRTSPStreamUrl]: DeviceRTSPStreamUrlProperty,
    };
  }
};