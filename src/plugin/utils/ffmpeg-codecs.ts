/* eslint-disable max-len */
/* 
 * This module is heavily inspired by the homebridge, homebridge-camera-ffmpeg and homebridge-unifi-protect source code. Thank you for your contributions to the HomeKit world.
 */
import { Logger as TsLogger, ILogObj } from 'tslog';
import { execFile } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';
import util from 'node:util';

import { EufySecurityPlatform } from '../platform.js';

export class FfmpegCodecs {

  private _gpuMem: number;
  private _ffmpegVersion: string;
  private readonly log: TsLogger<ILogObj> = this.platform.log;
  private readonly videoProcessor: string = this.platform.videoProcessor;
  private readonly videoProcessorCodecs: { [index: string]: { decoders: string[]; encoders: string[] } };
  private readonly videoProcessorHwAccels: { [index: string]: boolean };

  constructor(private readonly platform: EufySecurityPlatform) {
    this._gpuMem = 0;
    this._ffmpegVersion = '';
    this.videoProcessorCodecs = {};
    this.videoProcessorHwAccels = {};
  }

  // Launch our configured controllers once all accessories have been loaded. Once we do, they will sustain themselves.
  public async probe(): Promise<boolean> {

    // Let's conduct our system-specific capability probes.
    switch (this.platform.hostSystem) {

      case 'raspbian':
        // If we're on a Raspberry Pi, let's verify that we have enough GPU memory for hardware-based decoding and encoding.
        await this.probeRpiGpuMem();
        break;

      default:
        break;
    }

    // Capture the version information of FFmpeg.
    if (!(await this.probeFfmpegVersion())) {
      return false;
    }

    // Ensure we've got a working video processor before we do anything else.
    if (!(await this.probeVideoProcessorCodecs()) || !(await this.probeVideoProcessorHwAccel())) {
      return false;
    }

    return true;
  }

  // Utility to determine whether or not a specific decoder is available to the video processor for a given format.
  public hasDecoder(codec: string, decoder: string): boolean {

    // Normalize our lookups.
    codec = codec.toLowerCase();
    decoder = decoder.toLowerCase();

    return this.videoProcessorCodecs[codec]?.decoders.some(x => x === decoder);
  }

  // Utility to determine whether or not a specific encoder is available to the video processor for a given format.
  public hasEncoder(codec: string, encoder: string): boolean {

    // Normalize our lookups.
    codec = codec.toLowerCase();
    encoder = encoder.toLowerCase();

    return this.videoProcessorCodecs[codec]?.encoders.some(x => x === encoder);
  }

  // Utility to determine whether or not a specific decoder is available to the video processor for a given format.
  public hasHwAccel(accel: string): boolean {
    return this.videoProcessorHwAccels[accel.toLowerCase()] ? true : false;
  }

  // Utility that returns the amount of GPU memory available to us.
  public get gpuMem(): number {
    return this._gpuMem;
  }

  public get ffmpegVersion(): string {
    return this._ffmpegVersion;
  }

  private async probeFfmpegVersion(): Promise<boolean> {
    return this.probeCmd(this.videoProcessor, ['-hide_banner', '-version'], (stdout: string) => {

      // A regular expression to parse out the version.
      const versionRegex = /^ffmpeg version (.*) Copyright.*$/m;

      // Parse out the version string.
      const versionMatch = versionRegex.exec(stdout);

      // If we have a version string, let's save it. Otherwise, we're blind.
      this._ffmpegVersion = versionMatch ? versionMatch[1] : 'unknown';

      this.log.debug(`Using FFmpeg version: ${this.ffmpegVersion}`);
    });
  }

  // Probe our video processor's hardware acceleration capabilities.
  private async probeVideoProcessorHwAccel(): Promise<boolean> {
    if (!(await this.probeCmd(this.videoProcessor, ['-hide_banner', '-hwaccels'], (stdout: string) => {

      // Iterate through each line, and a build a list of encoders.
      for (const accel of stdout.split(os.EOL)) {

        // Skip blank lines.
        if (!accel.length) {
          continue;
        }

        // Skip the first line.
        if (accel === 'Hardware acceleration methods:') {
          continue;
        }

        // We've found a hardware acceleration method, let's add it.
        this.videoProcessorHwAccels[accel.toLowerCase()] = true;
      }
    }))) {
      return false;
    }

    // Let's test to ensure that just because we have a codec or capability available to us, it doesn't necessarily mean that the user has the hardware capabilities
    // needed to use it, resulting in an FFmpeg error. We catch that here and prevent those capabilities from being exposed to HBUP unless both software and hardware
    // capabilities enable it. This simple test, generates a one-second video that is processed by the requested codec. If it fails, we discard the codec.
    for (const accel of Object.keys(this.videoProcessorHwAccels)) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await this.probeCmd(this.videoProcessor, [

        '-hide_banner', '-hwaccel', accel, '-v', 'quiet', '-t', '1', '-f', 'lavfi', '-i', 'color=black:1920x1080', '-c:v', 'libx264', '-f', 'null', '-',
      ], () => { }, true))) {

        delete this.videoProcessorHwAccels[accel];
        this.log.error(`Hardware-accelerated decoding and encoding using ${accel} will be unavailable: unable to successfully validate capabilities.`);
      }
    }

    return true;
  }


  // Probe our video processor's encoding and decoding capabilities.
  private async probeVideoProcessorCodecs(): Promise<boolean> {

    return this.probeCmd(this.videoProcessor, ['-hide_banner', '-codecs'], (stdout: string) => {

      // A regular expression to parse out the codec and it's supported decoders.
      const decodersRegex = /\S+\s+(\S+).+\(decoders: (.*?)\s*\)/;

      // A regular expression to parse out the codec and it's supported encoders.
      const encodersRegex = /\S+\s+(\S+).+\(encoders: (.*?)\s*\)/;

      // Iterate through each line, and a build a list of encoders.
      for (const codecLine of stdout.split(os.EOL)) {

        // Let's see if we have decoders.
        const decodersMatch = decodersRegex.exec(codecLine);

        // Let's see if we have encoders.
        const encodersMatch = encodersRegex.exec(codecLine);

        // If we found decoders, add them to our list of supported decoders for this format.
        if (decodersMatch) {

          this.videoProcessorCodecs[decodersMatch[1]] = { decoders: [], encoders: [] };

          this.videoProcessorCodecs[decodersMatch[1]].decoders = decodersMatch[2].split(' ').map(x => x.toLowerCase());
        }

        // If we found decoders, add them to our list of supported decoders for this format.
        if (encodersMatch) {

          if (!this.videoProcessorCodecs[encodersMatch[1]]) {

            this.videoProcessorCodecs[encodersMatch[1]] = { decoders: [], encoders: [] };
          }

          this.videoProcessorCodecs[encodersMatch[1]].encoders = encodersMatch[2].split(' ').map(x => x.toLowerCase());
        }
      }
    });
  }

  // Probe Raspberry Pi GPU.
  private async probeRpiGpuMem(): Promise<boolean> {

    return this.probeCmd('vcgencmd', ['get_mem', 'gpu'], (stdout: string) => {

      // A regular expression to parse out the configured GPU memory on the Raspberry Pi.
      const gpuRegex = /^gpu=(.*)M\n$/;

      // Let's see what we've got.
      const gpuMatch = gpuRegex.exec(stdout);

      // We matched what we're looking for.
      if (gpuMatch) {

        // Parse the result and retrieve our allocated GPU memory.
        this._gpuMem = parseInt(gpuMatch[1]);

        // Something went wrong.
        if (isNaN(this._gpuMem)) {

          this._gpuMem = 0;
        }
      }
    });
  }

  // Utility to probe the capabilities of FFmpeg and the host platform.
  private async probeCmd(command: string, commandLineArgs: string[], processOutput: (output: string) => void, quietRunErrors = false): Promise<boolean> {

    try {

      // Promisify exec to allow us to wait for it asynchronously.
      const execAsync = util.promisify(execFile);

      // Check for the codecs in our video processor.
      const { stdout } = await execAsync(command, commandLineArgs);

      processOutput(stdout);

      return true;
    } catch (error) {

      // It's really a SystemError, but Node hides that type from us for esoteric reasons.
      if (error instanceof Error) {

        interface SystemError {
          cmd: string;
          code: string;
          errno: number;
          path: string;
          spawnargs: string[];
          stderr: string;
          stdout: string;
          syscall: string;
        }

        const execError = error as unknown as SystemError;

        if (execError.code === 'ENOENT') {

          this.log.error(`Unable to find '${command}' in path: '${process.env['PATH']}'.`);
        } else if (quietRunErrors) {

          return false;
        } else {

          this.log.error(`Error running ${command}: ${error.message}`);
        }
      }

      this.log.error(`Unable to probe the capabilities of your Homebridge host without access to '${command}'.
      Ensure that it is available in your path and correctly working.`);

      return false;
    }
  }
}