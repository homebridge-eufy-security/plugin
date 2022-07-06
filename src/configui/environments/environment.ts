// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

import { IHomebridgePluginUi } from '@homebridge/plugin-ui-utils/dist/ui.interface';
import '@homebridge/plugin-ui-utils/dist/ui.interface';

import { PluginUiMock } from './development/pluginUiMock';

  
// here you can set up the plugin mock to mimic the behavior you like
const homebridge = new PluginUiMock();

// homebridge.mimicPopulatedConfigWithoutAccessories();
homebridge.mimicAlreadyPopulatedConfigAndAccessories();
// homebridge.mimicWillRequestTFA();
// homebridge.mimicWillRequestCaptcha();
// homebridge.mimicLoginWillTimeoutOnce();
// homebridge.mimicFirstLogin();

window.homebridge = homebridge as unknown as IHomebridgePluginUi;




export const environment = {
  production: false,
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
