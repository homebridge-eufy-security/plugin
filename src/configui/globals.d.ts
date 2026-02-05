import { IHomebridgePluginUi } from '@homebridge/plugin-ui-utils/ui.interface';

declare global {
  interface Window {
    homebridge: IHomebridgePluginUi;
  }
}

export {};
