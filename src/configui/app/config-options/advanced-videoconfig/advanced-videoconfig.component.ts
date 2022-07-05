import { Component, Input, OnInit } from '@angular/core';
import { Accessory } from '../../../app/accessory';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

import { VideoConfig } from '../../../../plugin/accessories/configTypes';

@Component({
  selector: 'app-advanced-videoconfig',
  templateUrl: './advanced-videoconfig.component.html',
  styleUrls: ['./advanced-videoconfig.component.css'],
})
export class AdvancedVideoconfigComponent
  extends ConfigOptionsInterpreter
  implements OnInit {
  constructor(pluginService: PluginService) {
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

  debug: boolean | undefined = undefined;
  readRate: boolean | undefined = undefined;
  vcodec: string | undefined = undefined;
  acodec: string | undefined = undefined;
  videoFilter: string | undefined = undefined;
  encoderOptions: string | undefined = undefined;
  probeSize: number | undefined = undefined;
  analyzeDuration: number | undefined = undefined;
  mapvideo: string | undefined = undefined;
  mapaudio: string | undefined = undefined;
  forceMax: boolean | undefined = undefined;
  maxDelay: number | undefined = undefined;
  maxStreams: number | undefined = undefined;
  maxWidth: number | undefined = undefined;
  maxHeight: number | undefined = undefined;
  maxFPS: number | undefined = undefined;
  maxBitrate: number | undefined = undefined;

  async readValue() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'videoConfig')) {
      Object.entries(config['videoConfig']).forEach(([key, value]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj = this as any;
        obj[key] = value;
      });
    }
  }

  async update() {
    const config = await this.getCameraConfig(this.accessory?.uniqueId || '');

    const videoConfig =
      config && Object.prototype.hasOwnProperty.call(config, 'videoConfig')
        ? config['videoConfig']
        : {};
    const newConfig: VideoConfig = {};

    if (Object.prototype.hasOwnProperty.call(videoConfig, 'audio')) {
      newConfig['audio'] = videoConfig['audio'];
    }
    if (this.debug) {
      newConfig['debug'] = this.debug;
    }
    if (this.readRate) {
      newConfig['readRate'] = this.readRate;
    }
    if (this.vcodec && this.vcodec !== '') {
      newConfig['vcodec'] = this.vcodec;
    }
    if (this.acodec && this.acodec !== '') {
      newConfig['acodec'] = this.acodec;
    }
    if (this.videoFilter && this.videoFilter !== '') {
      newConfig['videoFilter'] = this.videoFilter;
    }
    if (this.encoderOptions && this.encoderOptions !== '') {
      newConfig['encoderOptions'] = this.encoderOptions;
    }
    if (this.probeSize !== undefined) {
      newConfig['probeSize'] = this.probeSize;
    }
    if (this.analyzeDuration !== undefined) {
      newConfig['analyzeDuration'] = this.analyzeDuration;
    }
    if (this.mapvideo && this.mapvideo !== '') {
      newConfig['mapvideo'] = this.mapvideo;
    }
    if (this.mapaudio && this.mapaudio !== '') {
      newConfig['mapaudio'] = this.mapaudio;
    }
    if (this.forceMax) {
      newConfig['forceMax'] = this.forceMax;
    }
    if (this.maxDelay !== undefined) {
      newConfig['maxDelay'] = this.maxDelay;
    }
    if (this.maxStreams !== undefined) {
      newConfig['maxStreams'] = this.maxStreams;
    }
    if (this.maxWidth !== undefined) {
      newConfig['maxWidth'] = this.maxWidth;
    }
    if (this.maxHeight !== undefined) {
      newConfig['maxHeight'] = this.maxHeight;
    }
    if (this.maxFPS !== undefined) {
      newConfig['maxFPS'] = this.maxFPS;
    }
    if (this.maxBitrate !== undefined) {
      newConfig['maxBitrate'] = this.maxBitrate;
    }

    this.updateConfig(
      {
        videoConfig: newConfig,
      },
      this.accessory,
    );
  }
}
