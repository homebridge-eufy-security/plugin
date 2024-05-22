import { EufySecurityPlatform, platformName, pluginName } from './platform';
import { setHap } from './utils/utils';

export default function (homebridge: any) {
  setHap(homebridge.hap);
  homebridge.registerPlatform(pluginName, platformName, EufySecurityPlatform, true);
}