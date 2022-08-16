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
  const deviceTypes = Object.values(DeviceType).filter(t => !isNaN(Number(t)));
  deviceTypes.forEach(deviceType => addRTSPPropertiesToDevice(deviceType));
};

const addRTSPPropertiesToDevice = (deviceType: string | DeviceType) => {
  let changed = false;

  if (DeviceProperties[deviceType] && !DeviceProperties[deviceType][PropertyName.DeviceRTSPStream]) {
    DeviceProperties[deviceType] = {
      ...DeviceProperties[deviceType],
      [PropertyName.DeviceRTSPStream]: DeviceRTSPStreamProperty,
    };
    changed = true;
  }

  if (DeviceProperties[deviceType] && !DeviceProperties[deviceType][PropertyName.DeviceRTSPStreamUrl]) {
    DeviceProperties[deviceType] = {
      ...DeviceProperties[deviceType],
      [PropertyName.DeviceRTSPStreamUrl]: DeviceRTSPStreamUrlProperty,
    };
    changed = true;
  }

  if (changed && DeviceProperties[deviceType] && !DeviceProperties[deviceType][PropertyName['ExperimentalModification']]) {
    DeviceProperties[deviceType] = {
      ...DeviceProperties[deviceType],
      [PropertyName['ExperimentalModification']]: DeviceExperimentalModification,
    };
  }
};

export const setRTSPCapability = (station: Station, device: Device, value: boolean) => {
  station.setRTSPStream(device, value);
};
