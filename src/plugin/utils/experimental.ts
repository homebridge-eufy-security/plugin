import {
  DeviceProperties,
  DeviceType,
  PropertyName,
  PropertyMetadataBoolean,
  DeviceRTSPStreamProperty,
  DeviceRTSPStreamUrlProperty,
  Station,
  Device,
} from 'eufy-security-client';

export const initializeExperimentalMode = () => {
  addRTSPPropertiesToAllDevices();
};

PropertyName['ExperimentalModification'] = 'experimentalModification';

const DeviceExperimentalModification: PropertyMetadataBoolean = {
  key: 0,
  name: PropertyName['ExperimentalModification'],
  label: 'Experimental Modification',
  readable: true,
  writeable: false,
  type: 'boolean',
};

const addRTSPPropertiesToAllDevices = () => {
  for (const deviceType in DeviceType) {
    addRTSPPropertiesToDevice(deviceType);
  }
};

const addRTSPPropertiesToDevice = (deviceType: string) => {
  let changed = false;

  if (!DeviceProperties[deviceType][PropertyName.DeviceRTSPStream]) {
    DeviceProperties[deviceType] = {
      ...DeviceProperties[deviceType],
      [PropertyName.DeviceRTSPStream]: DeviceRTSPStreamProperty,
    };
    changed = true;
  }

  if (!DeviceProperties[deviceType][PropertyName.DeviceRTSPStreamUrl]) {
    DeviceProperties[deviceType] = {
      ...DeviceProperties[deviceType],
      [PropertyName.DeviceRTSPStreamUrl]: DeviceRTSPStreamUrlProperty,
    };
    changed = true;
  }

  if (changed && !DeviceProperties[deviceType][PropertyName['ExperimentalModification']]) {
    DeviceProperties[deviceType] = {
      ...DeviceProperties[deviceType],
      [PropertyName['ExperimentalModification']]: DeviceExperimentalModification,
    };
  }
};

export const setRTSPCapability = (station: Station, device: Device, value: boolean) => {
  station.setRTSPStream(device, value);
};
