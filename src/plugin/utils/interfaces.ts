export class EufyClientNotRunningError extends Error {
  constructor(message?: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = EufyClientNotRunningError.name;
  }
}

export interface PluginConfigInteractor {
  DeviceIsCharging(sn: string): Promise<number>;
  DeviceSetExperimentalRTSP(sn: string, value: boolean): Promise<string>;
}