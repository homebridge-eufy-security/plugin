/* eslint-disable max-len */
import {
  AudioRecordingCodecType,
  AudioRecordingSamplerate,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraController,
  CameraControllerOptions,
  CameraRecordingOptions,
  CameraStreamingDelegate,
  CameraStreamingOptions,
  EventTriggerOption,
  H264Level,
  H264Profile,
  HAP,
  MediaContainerType,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  Resolution,
  SRTPCryptoSuites,
  SnapshotRequest,
  SnapshotRequestCallback,
  StartStreamRequest,
  StreamRequestCallback,
  StreamRequestTypes,
  StreamingRequest,
} from 'homebridge';
import { VideoCodecType } from 'hap-nodejs';

import { CameraAccessory } from '../accessories/CameraAccessory';
import { RecordingDelegate } from './record';
import { CameraConfig, VideoConfig } from './configTypes';
import { EufySecurityPlatform } from '../platform';
import { Logger as TsLogger, ILogObj } from 'tslog';
import { PROTECT_HKSV_SEGMENT_LENGTH, PROTECT_HKSV_TIMESHIFT_BUFFER_MAXLENGTH } from '../settings';
import { RtpDemuxer } from './rtp';
import { FfmpegOptions } from './ffmpeg-options';

import ffmpegPath from 'ffmpeg-for-homebridge';

import ffmpeg from 'fluent-ffmpeg';
import { StationStream } from '../controller/StationStream';

type SessionInfo = {
  address: string; // Address of the HomeKit client.
  addressVersion: string;

  videoPort: number;
  videoReturnPort: number;
  videoCryptoSuite: SRTPCryptoSuites; // This should be saved if multiple suites are supported.
  videoSRTP: Buffer; // Key and salt concatenated.
  videoSSRC: number; // RTP synchronisation source.

  hasAudioSupport: boolean | undefined; // Does the user have a version of FFmpeg that supports AAC-ELD?
  audioPort: number;
  audioIncomingRtcpPort: number;
  audioIncomingRtpPort: number; // Port to receive audio from the HomeKit microphone.
  rtpDemuxer: RtpDemuxer | null; // RTP demuxer needed for two-way audio.
  rtpPortReservations: number[]; // RTP port reservations.
  talkBack: string | null; // Talkback websocket needed for two-way audio.
  audioCryptoSuite: SRTPCryptoSuites;
  audioSRTP: Buffer;
  audioSSRC: number;
};

export class StreamingDelegate implements CameraStreamingDelegate {

  private resolutions: Resolution[] = [
    [320, 180, 30],
    [320, 240, 15], // Apple Watch requires this configuration
    [320, 240, 30],
    [480, 270, 30],
    [480, 360, 30],
    [640, 360, 30],
    [640, 480, 30],
    [1280, 720, 30],
    [1280, 960, 30],
    [1600, 1200, 30],
    [1920, 1080, 30],
  ];

  private controller: CameraController;

  private readonly platform: EufySecurityPlatform = this.camera.platform;
  private readonly hap: HAP = this.platform.api.hap;
  private readonly log: TsLogger<ILogObj> = this.platform.log;
  private readonly cameraName: string = this.camera.name;

  private cameraConfig: CameraConfig = this.camera.cameraConfig;
  private readonly videoConfig: VideoConfig = this.cameraConfig.videoConfig as VideoConfig;
  private readonly hksv: boolean = this.cameraConfig.hsv as boolean;
  private readonly talkback: boolean = this.cameraConfig.talkback as boolean;

  protected recordingDelegate?: RecordingDelegate = undefined;

  // Configure our hardware acceleration support.
  private ffmpegOptions = new FfmpegOptions(this.camera);

  // keep track of sessions
  private ongoingSessions: { [index: string]: { ffmpeg: ffmpeg[]; rtpDemuxer: RtpDemuxer | null; rtpPortReservations: number[] } } = {};
  private pendingSessions: { [index: string]: SessionInfo } = {};

  constructor(private camera: CameraAccessory) {

    // Setup for HKSV, if enabled.
    if (this.hksv) {
      this.log.debug(`${this.camera.name} has HKSV enabled`);
      this.recordingDelegate = new RecordingDelegate(camera);
    }

    this.controller = new this.hap.CameraController(this.getCameraControllerOptions());
  }

  public getController(): CameraController {
    return this.controller;
  }

  private getStreamingOptions(): CameraStreamingOptions {
    return {
      supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
      video: {
        resolutions: this.resolutions,
        codec: {
          profiles: [H264Profile.MAIN],
          levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
        },
      },
      audio: {
        twoWayAudio: this.talkback,
        codecs: [
          {
            type: AudioStreamingCodecType.AAC_ELD,
            samplerate: AudioStreamingSamplerate.KHZ_16,
            bitrate: 0,
            audioChannels: 1,
          },
        ],
      },
    };
  }

  private getRecordingOptions(): CameraRecordingOptions {
    return {
      overrideEventTriggerOptions: [
        EventTriggerOption.MOTION,
        EventTriggerOption.DOORBELL,
      ],
      prebufferLength: PROTECT_HKSV_TIMESHIFT_BUFFER_MAXLENGTH, // prebufferLength always remains 4s ?
      mediaContainerConfiguration: [
        {
          type: MediaContainerType.FRAGMENTED_MP4,
          fragmentLength: PROTECT_HKSV_SEGMENT_LENGTH,
        },
      ],
      video: {
        type: VideoCodecType.H264,
        parameters: {
          profiles: [H264Profile.MAIN],
          levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
        },
        resolutions: this.resolutions,
      },
      audio: {
        codecs: {
          type: AudioRecordingCodecType.AAC_ELD,
          samplerate: AudioRecordingSamplerate.KHZ_24,
        },
      },
    };
  }

  private getCameraControllerOptions(): CameraControllerOptions {

    const option: CameraControllerOptions = {
      cameraStreamCount: this.cameraConfig.videoConfig?.maxStreams || 2, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: this,
      streamingOptions: this.getStreamingOptions(),
      recording: this.hksv
        ? {
          options: this.getRecordingOptions(),
          delegate: this.recordingDelegate as RecordingDelegate,
        }
        : undefined,
      sensors: this.hksv
        ? {
          motion: this.camera.accessory.getService(this.platform.Service.MotionSensor),
          occupancy: undefined,
        }
        : undefined,
    };

    return option;
  }

  public async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {

    let reservePortFailed = false;
    const rtpPortReservations: number[] = [];

    // We use this utility to identify errors in reserving UDP ports for our use.
    const reservePort = async (ipFamily: ('ipv4' | 'ipv6') = 'ipv4', portCount: (1 | 2) = 1): Promise<number> => {

      // If we've already failed, don't keep trying to find more ports.
      if (reservePortFailed) {

        return -1;
      }

      // Retrieve the ports we're looking for.
      const assignedPort = await this.platform.rtpPorts.reservePort(ipFamily, portCount);

      // We didn't get the ports we requested.
      if (assignedPort === -1) {

        reservePortFailed = true;
      } else {

        // Add this reservation the list of ports we've successfully requested.
        rtpPortReservations.push(assignedPort);

        if (portCount === 2) {

          rtpPortReservations.push(assignedPort + 1);
        }
      }

      // Return them.
      return assignedPort;
    };

    // Check if the camera has a microphone and if we have audio support is enabled in the plugin.
    const isAudioEnabled = this.cameraConfig.videoConfig?.audio as boolean;

    // We need to check for AAC support because it's going to determine whether we support audio.
    const hasAudioSupport = isAudioEnabled && (this.ffmpegOptions.audioEncoder.length > 0);

    // Setup our audio plumbing.
    const audioIncomingRtcpPort = (await reservePort(request.addressVersion));
    const audioIncomingPort = (hasAudioSupport && this.camera.cameraConfig.talkback) ? (await reservePort(request.addressVersion)) : -1;
    const audioIncomingRtpPort = (hasAudioSupport && this.camera.cameraConfig.talkback) ? (await reservePort(request.addressVersion, 2)) : -1;

    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

    if (!hasAudioSupport) {

      this.log.info('Audio support disabled.%s', isAudioEnabled ? ' A version of FFmpeg that is compiled with fdk_aac support is required to support audio.' : '');
    }

    const rtpDemuxer: RtpDemuxer | null = null;
    const talkBack = null;

    // if (hasAudioSupport && this.camera.cameraConfig.talkback) {

    //   // Setup the RTP demuxer for two-way audio scenarios.
    //   rtpDemuxer = new RtpDemuxer(this, request.addressVersion, audioIncomingPort, audioIncomingRtcpPort, audioIncomingRtpPort);

    //   // Request the talkback websocket from the controller.
    //   const params = new URLSearchParams({ camera: this.camera.accessory.UUID });
    //   talkBack = await this.nvr.ufpApi.getWsEndpoint("talkback", params);

    //   // Something went wrong and we don't have a talkback websocket.
    //   if (!talkBack) {

    //     this.log.error("Unable to open the return audio channel.");
    //   }
    // }

    // Setup our video plumbing.
    const videoReturnPort = (await reservePort(request.addressVersion));
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

    // If we've had failures to retrieve the UDP ports we're looking for, inform the user.
    if (reservePortFailed) {

      this.log.error('Unable to reserve the UDP ports needed to begin streaming.');
    }

    const sessionInfo: SessionInfo = {

      address: request.targetAddress,
      addressVersion: request.addressVersion,

      audioCryptoSuite: request.audio.srtpCryptoSuite,
      audioIncomingRtcpPort: audioIncomingRtcpPort,
      audioIncomingRtpPort: audioIncomingRtpPort,
      audioPort: request.audio.port,
      audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSSRC: audioSSRC,

      hasAudioSupport: hasAudioSupport,
      rtpDemuxer: rtpDemuxer,
      rtpPortReservations: rtpPortReservations,
      talkBack: talkBack,

      videoCryptoSuite: request.video.srtpCryptoSuite,
      videoPort: request.video.port,
      videoReturnPort: videoReturnPort,
      videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC: videoSSRC,
    };

    // Prepare the response stream. Here's where we figure out if we're doing two-way audio or not. For two-way audio,
    // we need to use a demuxer to separate RTP and RTCP packets. For traditional video/audio streaming, we want to keep
    // it simple and don't use a demuxer.
    const response: PrepareStreamResponse = {

      audio: {

        port: (hasAudioSupport && this.talkback) ? audioIncomingPort : audioIncomingRtcpPort,
        // eslint-disable-next-line camelcase
        srtp_key: request.audio.srtp_key,
        // eslint-disable-next-line camelcase
        srtp_salt: request.audio.srtp_salt,
        ssrc: audioSSRC,
      },

      video: {

        port: videoReturnPort,
        // eslint-disable-next-line camelcase
        srtp_key: request.video.srtp_key,
        // eslint-disable-next-line camelcase
        srtp_salt: request.video.srtp_salt,
        ssrc: videoSSRC,
      },
    };

    // Add it to the pending session queue so we're ready to start when we're called upon.
    this.pendingSessions[request.sessionID] = sessionInfo;
    callback(undefined, response);
  }

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    const snapshot = undefined;

    // No snapshot was returned - we're done here.
    if (!snapshot) {
      if (callback) {
        callback(new Error(this.camera.accessory.displayName + ': Unable to retrieve a snapshot'));
      }
      return;
    }

    // Return the image to HomeKit.
    if (callback) {
      callback(undefined, snapshot);
    }
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    switch (request.type) {
      case StreamRequestTypes.START:
        this.startStream(request, callback);
        break;
      case StreamRequestTypes.RECONFIGURE:
        this.log.info(this.cameraName, 'Received request to reconfigure: ' + request.video.width + ' x ' + request.video.height + ', ' +
          request.video.fps + ' fps, ' + request.video.max_bit_rate + ' kbps (Ignored)', this.videoConfig.debug);
        callback();
        break;
      case StreamRequestTypes.STOP:
        this.stopStream(request.sessionID);
        callback();
        break;
    }
  }

  // Launch the Protect video (and audio) stream.
  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {

    const sessionInfo = this.pendingSessions[request.sessionID];
    const sdpIpVersion = sessionInfo.addressVersion === 'ipv6' ? 'IP6 ' : 'IP4';

    // If we aren't connected, we're done.
    if (!this.camera.isOnline) {
      const errorMessage = 'Unable to start video stream: the camera is offline or unavailable.';

      this.log.error(errorMessage);
      callback(new Error(this.camera.accessory.displayName + ': ' + errorMessage));
      return;
    }

    // Create a StationStream instance
    const stationStream = new StationStream(this.platform, this.camera.device);

    // Start the livestream
    await stationStream.startLivestream();

    // Create a read stream from StationStream
    const readStream = stationStream.createReadStream();
    const metadata = stationStream.getMetadata();


    // Set our packet size to be 564. Why? MPEG transport stream (TS) packets are 188 bytes in size each.
    // These packets transmit the video data that you ultimately see on your screen and are transmitted using
    // UDP. Each UDP packet is 1316 bytes in size, before being encapsulated in IP. We want to get as many
    // TS packets as we can, within reason, in those UDP packets. This translates to 1316 / 188 = 7 TS packets
    // as a limit of what can be pushed through a single UDP packet. Here's the problem...you need to have
    // enough data to fill that pipe, all the time. Network latency, FFmpeg overhead, and the speed / quality of
    // the original camera stream all play a role here, and as you can imagine, there's a nearly endless set of
    // combinations to decide how to best fill that pipe. Set it too low, and you're incurring extra overhead by
    // pushing less video data to clients in each packet, though you're increasing interactivity by getting
    // whatever data you have to the end user. Set it too high, and startup latency becomes unacceptable
    // when you begin a stream.
    //
    // For audio, you have a latency problem and a packet size that's too big will force the audio to sound choppy
    // - so we opt to increase responsiveness at the risk of more overhead. This gives the end user a much better
    // audio experience, at a marginal cost in bandwidth overhead.
    //
    // Through experimentation, I've found a sweet spot of 188 * 3 = 564 for video on Protect cameras. In my testing,
    // adjusting the packet size beyond 564 did not have a material impact in improving the startup time, and often had
    // a negative impact.
    const videomtu = 188 * 3;
    const audiomtu = 188 * 1;

    // Use fluent-ffmpeg to process the stream
    const ffmpegStream = ffmpeg
      .setFfmpegPath(ffmpegPath)

      .input(readStream)
      .native()
      .videoCodec('libx264')  // or use the codec from stationStream.getMetadata()
      .audioCodec('aac')      // or use the codec from stationStream.getMetadata()
      .format('mp4')

      .on('start', (commandLine) => {
        this.log.info('Spawned Ffmpeg with command: ' + commandLine);
      })
      .on('end', () => {
        this.log.info('Stream processing finished.');
        stationStream.stopLivestream();
      })
      .on('error', (error) => {
        this.log.error(`An error occurred: ${error.message}`);
        stationStream.stopLivestream();
      })

      .outputOptions([
        '-payload_type ' + request.video.pt.toString(),
        '-ssrc ' + sessionInfo.videoSSRC.toString(),
        '-f rtp',
        '-srtp_out_suite AES_CM_128_HMAC_SHA1_80',
        '-srtp_out_params ' + sessionInfo.videoSRTP.toString('base64'),
      ])
      .output(`srtp://${sessionInfo.address}:${sessionInfo.videoPort}?rtcpport=${sessionInfo.videoPort}&pkt_size=${videomtu}`)

      .run();

    // Some housekeeping for our FFmpeg and demuxer sessions.
    this.ongoingSessions[request.sessionID] = {

      ffmpeg: [ffmpegStream],
      rtpDemuxer: sessionInfo.rtpDemuxer,
      rtpPortReservations: sessionInfo.rtpPortReservations,
    };

    delete this.pendingSessions[request.sessionID];

    // If we aren't doing two-way audio, we're done here. For two-way audio...we have some more plumbing to do.
    if (!sessionInfo.hasAudioSupport || !this.camera.cameraConfig.talkback) {

      return;
    }
  }

  // Close a video stream.
  public async stopStream(sessionId: string): Promise<void> {

    try {

      // Stop any FFmpeg instances we have running.
      if (this.ongoingSessions[sessionId]) {

        for (const ffmpegProcess of this.ongoingSessions[sessionId].ffmpeg) {
          ffmpegProcess.stop();
        }

        // Close the demuxer, if we have one.
        this.ongoingSessions[sessionId].rtpDemuxer?.close();

        // Inform the user.
        this.log.info(`${this.cameraName} Stopped video streaming session.`);

        // Release our port reservations.
        this.ongoingSessions[sessionId].rtpPortReservations.map(x => this.platform.rtpPorts.freePort(x));
      }

      // On the off chance we were signaled to prepare to start streaming, but never actually started streaming, cleanup after ourselves.
      if (this.pendingSessions[sessionId]) {

        // Release our port reservations.
        this.pendingSessions[sessionId].rtpPortReservations.map(x => this.platform.rtpPorts.freePort(x));
      }

      // Delete the entries.
      delete this.pendingSessions[sessionId];
      delete this.ongoingSessions[sessionId];

    } catch (error) {
      this.log.error(`${this.cameraName} Error occurred while ending the FFmpeg video processes: ${error}`);
    }
  }
}