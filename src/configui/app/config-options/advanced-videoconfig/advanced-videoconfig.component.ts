import { Component, Input, OnInit } from '@angular/core';
import { L_Device } from '../../../app/util/types';
import { PluginService } from '../../../app/plugin.service';
import { ConfigOptionsInterpreter } from '../config-options-interpreter';

import { VideoConfig } from '../../../../plugin/utils/configTypes';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-advanced-videoconfig',
  templateUrl: './advanced-videoconfig.component.html',
  standalone: true,
  imports: [FormsModule, NgIf],
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

  @Input() device?: L_Device;

  debug: boolean | undefined = undefined;
  readRate: boolean | undefined = undefined;
  vcodec: string | undefined = undefined;
  acodec: string | undefined = undefined;
  videoFilter: string | undefined = undefined;
  encoderOptions: string | undefined = undefined;
  probeSize: number | undefined = undefined;
  analyzeDuration: number | undefined = undefined;
  maxStreams: number | undefined = undefined;
  maxWidth: number | undefined = undefined;
  maxHeight: number | undefined = undefined;
  maxFPS: number | undefined = undefined;
  maxBitrate: number | undefined = undefined;
  useSeparateProcesses: boolean | undefined = undefined;

  preset = 0;
  presetDescription?: string;

  async readValue() {
    const config = this.getCameraConfig(this.device?.uniqueId || '');

    if (config && Object.prototype.hasOwnProperty.call(config, 'videoConfig')) {
      Object.entries(config['videoConfig']).forEach(([key, value]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj = this as any;
        obj[key] = value;
      });
    }

    this.updatePreset();
  }

  loadPreset() {
    if (this.preset === 0) {
      this.readRate = undefined;
      this.vcodec = undefined;
      this.acodec = undefined;
      this.videoFilter = undefined;
      this.encoderOptions = undefined;
      this.probeSize = undefined;
      this.analyzeDuration = undefined;
      this.maxStreams = undefined;
      this.maxWidth = undefined;
      this.maxHeight = undefined;
      this.maxFPS = undefined;
      this.maxBitrate = undefined;
      this.useSeparateProcesses = undefined;

      this.presetDescription = undefined;
    } else if (this.preset === 1) {
      this.readRate = undefined;
      this.vcodec = 'copy';
      this.acodec = undefined;
      this.videoFilter = undefined;
      this.encoderOptions = undefined;
      this.probeSize = undefined;
      this.analyzeDuration = undefined;
      this.maxStreams = undefined;
      this.maxWidth = undefined;
      this.maxHeight = undefined;
      this.maxFPS = undefined;
      this.maxBitrate = undefined;
      this.useSeparateProcesses = true;
      this.presetDescription = 'Most eufy cams support the same codec that HomeKit requests. You can try and \'forward\' the stream directly without encoding it with ffmpeg. This can increase performance and quality drastically.';
    } else if (this.preset === 2) {
      this.readRate = undefined;
      this.vcodec = undefined;
      this.acodec = undefined;
      this.videoFilter = undefined;
      this.encoderOptions = undefined;
      this.probeSize = undefined;
      this.analyzeDuration = undefined;
      this.maxStreams = undefined;
      this.maxWidth = 640;
      this.maxHeight = 480;
      this.maxFPS = 15;
      this.maxBitrate = undefined;
      this.useSeparateProcesses = true;

      this.presetDescription = 'This preset tries to increase performance by reducing the quality of the stream. This can work for low performance hardware like raspberry pis.';
    } else {
      this.presetDescription = undefined;
    }

    this.update();
  }

  private updatePreset() {
    let p = 3;
    if (!this.readRate &&
      this.vcodec === undefined &&
      this.acodec === undefined &&
      this.videoFilter === undefined &&
      this.encoderOptions === undefined &&
      this.probeSize === undefined &&
      this.analyzeDuration === undefined &&
      this.maxStreams === undefined &&
      this.maxWidth === undefined &&
      this.maxHeight === undefined &&
      this.maxFPS === undefined &&
      this.maxBitrate === undefined &&
      this.useSeparateProcesses === undefined) {

      p = 0;
    }
    if (!this.readRate &&
      this.vcodec === 'copy' &&
      this.acodec === undefined &&
      this.videoFilter === undefined &&
      this.encoderOptions === undefined &&
      this.probeSize === undefined &&
      this.analyzeDuration === undefined &&
      this.maxStreams === undefined &&
      this.maxWidth === undefined &&
      this.maxHeight === undefined &&
      this.maxFPS === undefined &&
      this.maxBitrate === undefined &&
      this.useSeparateProcesses === true) {

      p = 1;
    }
    if (!this.readRate &&
      this.vcodec === undefined &&
      this.acodec === undefined &&
      this.videoFilter === undefined &&
      this.encoderOptions === undefined &&
      this.probeSize === undefined &&
      this.analyzeDuration === undefined &&
      this.maxStreams === undefined &&
      this.maxWidth === 640 &&
      this.maxHeight === 480 &&
      this.maxFPS === 15 &&
      this.maxBitrate === undefined &&
      this.useSeparateProcesses === true) {

      p = 2;
    }

    if (p !== this.preset) {
      this.preset = p;
    }
  }

  async update() {
    const config = this.getCameraConfig(this.device?.uniqueId || '');

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
    if (this.useSeparateProcesses) {
      newConfig['useSeparateProcesses'] = this.useSeparateProcesses;
    }

    this.updateDeviceConfig(
      {
        videoConfig: newConfig,
      },
      this.device!,
    );

    this.updatePreset();
  }
}
