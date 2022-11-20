import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../accessory';
import { AccessoryService } from '../../accessory.service';
import { PluginService } from '../../plugin.service';
import { DEFAULT_CAMERACONFIG_VALUES } from '../../util/default-config-values';
import { ChargingStatus } from '../../util/eufy-security-client.utils';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

import { VideoConfig } from '../../../../plugin/utils/configTypes';

import { faQuestionCircle } from '@fortawesome/free-regular-svg-icons';

@Component({
  selector: 'app-enable-hsv',
  templateUrl: './enable-hsv.component.html',
  styles: [
  ],
})
export class EnableHsvComponent extends ConfigOptionsInterpreter implements OnInit {

  faQuestionCircle = faQuestionCircle;

  constructor(
    pluginService: PluginService,
    private accessoryService: AccessoryService,
  ) {
    super(pluginService);
  }

  ngOnInit(): void {
    this.readValue();
  }

  /** Customize from here */
  /** updateConfig() will overwrite any settings that you'll provide */
  /** Don't try and 'append'/'push' to arrays this way - add a custom method instead */
  /** see config option to ignore devices as example */

  /** updateConfig() takes an optional second parameter to specify the accessoriy for which the setting is changed */

  @Input() accessory?: Accessory;
  value = DEFAULT_CAMERACONFIG_VALUES.hsv;

  showAdvancedSettings = false;

  // debug: boolean | undefined = undefined;
  // readRate: boolean | undefined = undefined;
  vcodec: string | undefined = undefined;
  // acodec: string | undefined = undefined;
  videoFilter: string | undefined = undefined;
  encoderOptions: string | undefined = undefined;
  // probeSize: number | undefined = undefined;
  // analyzeDuration: number | undefined = undefined;
  // maxStreams: number | undefined = undefined;
  // maxWidth: number | undefined = undefined;
  // maxHeight: number | undefined = undefined;
  maxFPS: number | undefined = undefined;
  maxBitrate: number | undefined = undefined;
  // useSeparateProcesses: boolean | undefined = undefined;
  // crop: boolean | undefined = undefined;
  audio = true;
  // audioSampleRate: number | undefined = undefined;
  // audioBitrate: number | undefined = undefined;
  // acodecHK: string | undefined = undefined;
  // acodecOptions: string | undefined = undefined;
  // videoProcessor: string | undefined = undefined;

  // acodecPlaceholder = 'libfdk_aac';
  // acodecOptionsPlaceholder = '-profile:a aac_eld';
  vcodecOptionsPlaceholder = '-preset ultrafast -tune zerolatency';

  chargingStatus = ChargingStatus.PLUGGED;
  camerasOnSameStation: string[] = [];

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'hsv')) {
      this.value = config['hsv'];
    }

    if (config && Object.prototype.hasOwnProperty.call(config, 'hsvConfig')) {
      Object.entries(config['hsvConfig']).forEach(([key, value]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj = this as any;
        obj[key] = value;
      });
    }

    if (this.accessory) {
      this.accessoryService.getChargingStatus(this.accessory.uniqueId)
        .then((chargingStatus) => this.chargingStatus = chargingStatus);

      const ignoredDevices = (config && Object.prototype.hasOwnProperty.call(config, 'ignoreDevices')) ? config['ignoreDevices'] : [];
      this.accessoryService.getCamerasOnSameStation(this.accessory.uniqueId, ignoredDevices)
        .then(devices => {
          this.camerasOnSameStation = devices;
          if (this.camerasOnSameStation.length > 1) {
            this.value = false;
            this.update();
          }
        });
    }

    this.placeholderUpdate();
  }

  private placeholderUpdate() {
    // switch (this.acodecHK) {
    //   case 'ACC-eld':
    //     this.acodecPlaceholder = 'libfdk_aac';
    //     this.acodecOptionsPlaceholder = '-profile:a aac_eld';
    //     break;
    //   case 'OPUS':
    //     this.acodecPlaceholder = 'libopus';
    //     this.acodecOptionsPlaceholder = '-application lowdelay';
    //     break;
    //   default:
    //     this.acodecPlaceholder = 'libfdk_aac';
    //     this.acodecOptionsPlaceholder = '-profile:a aac_eld';
    //     break;
    // }

    switch (this.vcodec) {
      case 'copy':
        this.vcodecOptionsPlaceholder = '';
        break;
      case '':
      case 'libx264':
      case undefined:
        this.vcodecOptionsPlaceholder = '-preset ultrafast -tune zerolatency';
        break;
      default:
        this.vcodecOptionsPlaceholder = 'leave blank if you don\'t know';
        break;
    }
  }

  async update() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');
    const videoConfig =
      config && Object.prototype.hasOwnProperty.call(config, 'videoConfig')
        ? config['videoConfig']
        : {};
    const newConfig: VideoConfig = {};

    
    if (!this.audio) {
      newConfig['audio'] = this.audio;
    }
    if (this.vcodec && this.vcodec !== '') {
      newConfig['vcodec'] = this.vcodec;
    }
    if (this.videoFilter && this.videoFilter !== '') {
      newConfig['videoFilter'] = this.videoFilter;
    }
    if (this.encoderOptions !== undefined) {
      newConfig['encoderOptions'] = this.encoderOptions;
    }
    if (this.maxFPS !== undefined) {
      newConfig['maxFPS'] = this.maxFPS;
    }
    if (this.maxBitrate !== undefined) {
      newConfig['maxBitrate'] = this.maxBitrate;
    }

    this.updateConfig(
      {
        hsv: this.value,
        hsvConfig: newConfig,
      },
      this.accessory,
    );

    this.placeholderUpdate();
  }

}
