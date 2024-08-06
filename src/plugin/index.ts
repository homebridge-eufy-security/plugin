import { API } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { EufySecurityPlatform } from './platform';
import { setHap } from './utils/utils';

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
  setHap(api.hap);
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, EufySecurityPlatform);
};