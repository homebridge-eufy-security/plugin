/* eslint-disable max-len */
/* eslint-disable indent */
import {
  API,
  APIEvent,
  CameraController,
  CameraStreamingDelegate,
  HAP,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SnapshotRequest,
  SnapshotRequestCallback,
  SRTPCryptoSuites,
  StartStreamRequest,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes,
} from 'homebridge';

import { CameraConfig, VideoConfig } from '../utils/configTypes';
import { Logger as TsLogger, ILogObj } from 'tslog';

import { AudioCodec, Camera, PropertyName } from 'eufy-security-client';
import { EufySecurityPlatform } from '../platform';

import { LocalLivestreamManager, StationStream } from './LocalLivestreamManager';
import { SnapshotManager } from './SnapshotManager';
import { TalkbackStream } from './Talkback';
import { is_rtsp_ready } from '../utils/utils';
import { CameraAccessory } from '../accessories/CameraAccessory';
import { reservePorts } from '@homebridge/camera-utils';
import { FfmpegStreamingProcess } from '../utils/ffmpeg-stream';
import { FfmpegOptions } from '../utils/ffmpeg-options';

export type SessionInfo = {
  address: string; // address of the HAP controller
  addressVersion: string;

  videoPort: number;
  videoReturnPort: number;
  videoCryptoSuite: SRTPCryptoSuites; // should be saved if multiple suites are supported
  videoSRTP: Buffer; // key and salt concatenated
  videoSSRC: number; // rtp synchronisation source

  audioPort: number;
  audioReturnPort: number;
  audioCryptoSuite: SRTPCryptoSuites;
  audioSRTP: Buffer;
  audioSSRC: number;
};

type ActiveSession = {
  videoProcess?: FfmpegStreamingProcess;
  returnProcess?: FfmpegStreamingProcess;
  timeout?: NodeJS.Timeout;
  cachedStream?: StationStream;
  talkbackStream?: TalkbackStream;
};

export class StreamingDelegate implements CameraStreamingDelegate {

  private readonly platform: EufySecurityPlatform = this.camera.platform;
  private readonly device: Camera = this.camera.device;
  private readonly hap: HAP = this.platform.api.hap;
  private readonly api: API = this.platform.api;
  private readonly log: TsLogger<ILogObj> = this.platform.log;
  private readonly cameraName: string = this.camera.name;
  public readonly ffmpegOptions: FfmpegOptions = new FfmpegOptions(this.camera);

  private cameraConfig: CameraConfig = this.camera.cameraConfig;
  private videoConfig: VideoConfig = this.cameraConfig.videoConfig!;
  public controller?: CameraController;

  private probesizeOverride: number = 0;
  private probesizeOverrideCount: number = 0;
  private probesizeOverrideTimeout?: NodeJS.Timeout;

  public readonly localLivestreamManager: LocalLivestreamManager = new LocalLivestreamManager(
    this.camera,
  );

  private snapshotManager: SnapshotManager = new SnapshotManager(
    this.camera,
    this.localLivestreamManager,
  );

  // keep track of sessions
  pendingSessions: Map<string, SessionInfo> = new Map();
  ongoingSessions: Map<string, ActiveSession> = new Map();
  timeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    public readonly camera: CameraAccessory,
  ) {

    this.api.on(APIEvent.SHUTDOWN, () => {
      for (const session in this.ongoingSessions) {
        this.stopStream(session);
      }
      this.localLivestreamManager.stopLocalLiveStream();
    });
  }

  public setController(controller: CameraController) {
    this.controller = controller;
  }

  public getLivestreamManager(): LocalLivestreamManager {
    return this.localLivestreamManager;
  }

  public async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    this.log.debug(`${this.cameraName} Handling snapshot request`);

    try {
      this.log.debug(`${this.cameraName} Snapshot requested: ${request.width} x ${request.height}`);
      const snapshot: Buffer = await this.snapshotManager.getSnapshotBuffer(request);
      this.log.debug(`${this.cameraName} snapshot byte lenght: ${snapshot?.byteLength}`);
      callback(undefined, snapshot);
    } catch (err) {
      this.log.error(this.cameraName, err as string);
      callback(undefined, undefined);
    }
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
    this.log.debug(`${this.cameraName} stream prepare request with session id ${request.sessionID} was received.`);

    const ports = await reservePorts({ count: 2, type: 'udp' });

    if (!ports) {
      return;
    }

    const videoReturnPort = ports[0];
    const audioReturnPort = ports[1];

    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

    const rtsp = is_rtsp_ready(this.device, this.cameraConfig, this.log);

    const sessionInfo: SessionInfo = {
      address: request.targetAddress,
      addressVersion: request.addressVersion,

      videoPort: request.video.port,
      videoReturnPort: videoReturnPort,
      videoCryptoSuite: request.video.srtpCryptoSuite,
      videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC: videoSSRC,

      audioPort: request.audio.port,
      audioReturnPort: audioReturnPort,
      audioCryptoSuite: request.audio.srtpCryptoSuite,
      audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSSRC: audioSSRC,
    };

    const response: PrepareStreamResponse = {
      video: {
        port: videoReturnPort,
        ssrc: videoSSRC,

        srtp_key: request.video.srtp_key,
        srtp_salt: request.video.srtp_salt,
      },
      audio: {
        port: audioReturnPort,
        ssrc: audioSSRC,

        srtp_key: request.audio.srtp_key,
        srtp_salt: request.audio.srtp_salt,
      },
    };

    this.pendingSessions.set(request.sessionID, sessionInfo);
    callback(undefined, response);
  }

  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {

    const sessionInfo = this.pendingSessions.get(request.sessionID)!;
    const sdpIpVersion = sessionInfo.addressVersion === 'ipv6' ? 'IP6 ' : 'IP4';

    if (!sessionInfo) {
      this.log.error(this.cameraName, 'Error finding session information.');
      callback(new Error('Error finding session information'));
      return;
    }

    this.log.debug(this.cameraName, 'VIDEOCONFIG: ' + this.videoConfig);

    try {
      const activeSession: ActiveSession = {};

      const rtsp = is_rtsp_ready(this.device, this.cameraConfig, this.log);

      let video_url = '';
      let audio_url = '';

      if (rtsp) {
        video_url = this.device.getPropertyValue(PropertyName.DeviceRTSPStreamUrl).toString();
        this.platform.log.debug(this.cameraName, 'RTSP URL: ' + video_url);
      } else {
        try {

          activeSession.cachedStream = await this.localLivestreamManager.getLocalLivestream()
            .catch((err) => {
              throw err;
            });

          video_url = activeSession.cachedStream.vStream.url;
          audio_url = activeSession.cachedStream.aStream.url;

        } catch (err) {
          this.log.error((this.cameraName + ' Unable to start the livestream: ' + err) as string);
          callback(err as Error);
          this.pendingSessions.delete(request.sessionID);
          return;
        }
      }

      const ffmpegArgs: string[] = [];

      try {

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

        // -hide_banner                     Suppress printing the startup banner in FFmpeg.
        // -nostats                         Suppress printing progress reports while encoding in FFmpeg.
        // -fflags flags                    Set format flags to discard any corrupt packets rather than exit.
        // -probesize number                How many bytes should be analyzed for stream information.
        // -max_delay 500000                Set an upper limit on how much time FFmpeg can take in demuxing packets, in microseconds.
        // -r fps                           Set the input frame rate for the video stream.
        // -rtsp_transport tcp              Tell the RTSP stream handler that we're looking for a TCP connection.
        // -i this.rtspEntry.url            RTSPS URL to get our input stream from.
        // -map 0:v:0                       selects the first available video track from the stream. Protect actually maps audio
        //                                  and video tracks in opposite locations from where FFmpeg typically expects them. This
        //                                  setting is a more general solution than naming the track locations directly in case
        //                                  Protect changes this in the future.
        //
        //                                  Yes, we included these above as well: they need to be included for each I/O stream to maximize effectiveness it seems.

        ffmpegArgs.push(
          // '-hide_banner',
          '-re',
          '-nostats',
          '-fflags', '+discardcorrupt+nobuffer',
          ...this.ffmpegOptions.videoDecoder,
          // '-probesize', `${this.probesize}`,
          '-max_delay', '200000',
          '-thread_queue_size', '256',
          '-r', `${this.camera.metadata.videoFPS}`,
          '-c:v', `${(this.camera.metadata.videoCodec === 0) ? 'h264' : 'h265'}`,
          '-i', video_url,
          '-map', '0:v:0',
        );

        // Configure our video parameters for just copying the input stream from Protect - it tends to be quite solid in most cases:
        //
        // -vcodec copy        Copy the stream withour reencoding it.
        ffmpegArgs.push(

          '-vcodec', 'copy',
        );


        // Configure our video parameters for SRTP streaming:
        //
        // -payload_type num                Payload type for the RTP stream. This is negotiated by HomeKit and is usually 99 for H.264 video.
        // -ssrc                            Synchronization source stream identifier. Random number negotiated by HomeKit to identify this stream.
        // -f rtp                           Specify that we're using the RTP protocol.
        // -srtp_out_suite enc              Specify the output encryption encoding suites.
        // -srtp_out_params params          Specify the output encoding parameters. This is negotiated by HomeKit.
        ffmpegArgs.push(
          '-payload_type', `${request.video.pt}`,
          '-ssrc', `${sessionInfo!.videoSSRC}`,
          '-f', 'rtp',
          '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
          '-srtp_out_params', `${sessionInfo!.videoSRTP.toString('base64')}`,
          `srtp://${sessionInfo!.address}:${sessionInfo!.videoPort}?rtcpport=${sessionInfo!.videoPort}&pkt_size=${videomtu}`,
        );


        // Configure the audio portion of the command line, if we have a version of FFmpeg supports the audio codecs we need. Options we use are:
        //
        // -map 0:a:0?                      Selects the first available audio track from the stream, if it exists. Protect actually maps audio
        //                                  and video tracks in opposite locations from where FFmpeg typically expects them. This
        //                                  setting is a more general solution than naming the track locations directly in case
        //                                  Protect changes this in the future.
        // -acodec                          Encode using the codecs available to us on given platforms.
        // -profile:a 38                    Specify enhanced, low-delay AAC for HomeKit.
        // -flags +global_header            Sets the global header in the bitstream.
        // -f null                          Null filter to pass the audio unchanged without running through a muxing operation.
        // -ar samplerate                   Sample rate to use for this audio. This is specified by HomeKit.
        // -b:a bitrate                     Bitrate to use for this audio stream. This is specified by HomeKit.
        // -bufsize size                    This is the decoder buffer size, which drives the variability / quality of the output bitrate.
        // -ac 1                            Set the number of audio channels to 1.
        if (this.cameraConfig.videoConfig?.audio) {

          // Map the AudioCodec enum to FFmpeg codec names
          const audioCodecMap: { [key in AudioCodec]: string } = {
            [AudioCodec.UNKNOWN]: '',
            [AudioCodec.NONE]: '',
            [AudioCodec.AAC]: 'aac',
            [AudioCodec.AAC_LC]: 'aac',
            [AudioCodec.AAC_ELD]: 'aac_eld',
          };

          // Configure our audio parameters.
          ffmpegArgs.push(
            '-thread_queue_size', '256',
            '-c:a', `${audioCodecMap[this.camera.metadata.audioCodec]}`,
            '-async', '1',
            '-i', audio_url,
            '-map', '1:a:0',
            ...this.ffmpegOptions.audioEncoder,
            '-profile:a', '38',
            // '-acodec', 'copy',
            '-flags', '+global_header',
            '-f', 'null',
            '-ar', `${request.audio.sample_rate}k`,
            '-b:a', `${request.audio.max_bit_rate}k`,
            '-bufsize', `${(2 * request.audio.max_bit_rate)}k`,
            '-ac', `${request.audio.channel}`,
          );

          // Add the required RTP settings and encryption for the stream:
          //
          // -payload_type num                Payload type for the RTP stream. This is negotiated by HomeKit and is usually 110 for AAC-ELD audio.
          // -ssrc                            synchronization source stream identifier. Random number negotiated by HomeKit to identify this stream.
          // -f rtp                           Specify that we're using the RTP protocol.
          // -srtp_out_suite enc              Specify the output encryption encoding suites.
          // -srtp_out_params params          Specify the output encoding parameters. This is negotiated by HomeKit.

          ffmpegArgs.push(
            '-payload_type', `${request.audio.pt}`,
            '-ssrc', `${sessionInfo!.audioSSRC}`,
            '-f', 'rtp',
            '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
            '-srtp_out_params', `${sessionInfo!.audioSRTP.toString('base64')}`,
            `srtp://${sessionInfo!.address}:${sessionInfo!.audioPort}?rtcpport=${sessionInfo!.audioPort}&pkt_size=${audiomtu}`,
          );
        }

        // if (this.platform.config.enableDetailedLogging) {
        //   ffmpegArgs.push('-loglevel', 'level+debug');
        // }

      } catch (error) {
        this.log.error((this.cameraName + ' Unable to prep ffmpegArgs: ' + error) as string);
      }

      // Combine everything and start an instance of FFmpeg.
      const videoProcess = new FfmpegStreamingProcess(this, request.sessionID, ffmpegArgs, undefined, callback);

      videoProcess.on('started', () => {
        callback();
      });

      videoProcess.on('error', (err) => {
        this.log.error(this.cameraName, 'Video process ended with error: ' + err);
        this.stopStream(request.sessionID);
      });

      activeSession.videoProcess = videoProcess;

      // if (this.cameraConfig.talkback) {
      //   const talkbackParameters = await FFmpegParameters.forAudio(this.videoConfig.debug);
      //   await talkbackParameters.setTalkbackInput(sessionInfo!);
      //   if (this.cameraConfig.talkbackChannels) {
      //     talkbackParameters.setTalkbackChannels(this.cameraConfig.talkbackChannels);
      //   }
      //   activeSession.talkbackStream = new TalkbackStream(this.platform, this.device);
      //   activeSession.returnProcess = new FFmpeg(
      //     `[${this.cameraName}] [Talkback Process]`,
      //     [talkbackParameters],
      //     this.platform.ffmpegLogger,
      //   );
      //   activeSession.returnProcess.on('error', (err) => {
      //     this.log.error(this.cameraName, 'Talkback process ended with error: ' + err);
      //   });
      //   activeSession.returnProcess.start();
      //   activeSession.returnProcess.stdout?.pipe(activeSession.talkbackStream);
      // }

      // Check if the pendingSession has been stopped before it was successfully started.
      const pendingSession = this.pendingSessions.get(request.sessionID);
      // pendingSession has not been deleted. Transfer it to ongoingSessions.
      if (pendingSession) {
        this.ongoingSessions.set(request.sessionID, activeSession);
        this.pendingSessions.delete(request.sessionID);
      } else { // pendingSession has been deleted. Add it to ongoingSession and end it immediately.
        this.ongoingSessions.set(request.sessionID, activeSession);
        this.log.info(this.cameraName, 'pendingSession has been deleted. Add it to ongoingSession and end it immediately.');
        this.stopStream(request.sessionID);
      }

    } catch (err) {
      this.log.error(this.cameraName, 'Stream could not be started: ' + err);
      callback(err as Error);
      this.pendingSessions.delete(request.sessionID);
    }
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    switch (request.type) {
      case StreamRequestTypes.START:
        this.log.debug(this.cameraName, `Received request to start stream with id ${request.sessionID}`);
        this.log.debug(this.cameraName, `request data: ${request}`);
        this.startStream(request, callback);
        break;
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug(
          this.cameraName,
          'Received request to reconfigure: ' +
          request.video.width +
          ' x ' +
          request.video.height +
          ', ' +
          request.video.fps +
          ' fps, ' +
          request.video.max_bit_rate +
          ' kbps (Ignored)',
          this.videoConfig.debug,
        );
        callback();
        break;
      case StreamRequestTypes.STOP:
        this.log.debug(this.cameraName + ' Receive Apple HK Stop request' + request);
        this.stopStream(request.sessionID);
        callback();
        break;
    }
  }

  public stopStream(sessionId: string): void {
    this.log.debug('Stopping session with id: ' + sessionId);

    const pendingSession = this.pendingSessions.get(sessionId);
    if (pendingSession) {
      this.pendingSessions.delete(sessionId);
    }

    const session = this.ongoingSessions.get(sessionId);
    if (session) {
      if (session.timeout) {
        clearTimeout(session.timeout);
      }
      try {
        session.talkbackStream?.stopTalkbackStream();
        session.returnProcess?.stdout?.unpipe();
        session.returnProcess?.stop();
      } catch (err) {
        this.log.error(this.cameraName, 'Error occurred terminating returnAudio FFmpeg process: ' + err);
      }
      try {
        session.videoProcess?.stop();
      } catch (err) {
        this.log.error(this.cameraName, 'Error occurred terminating video FFmpeg process: ' + err);
      }
      try {
        if (!is_rtsp_ready(this.device, this.cameraConfig, this.log) && session.cachedStream) {
          session.cachedStream.vStream.close();
          session.cachedStream.aStream.close();
          this.localLivestreamManager.stopLocalLiveStream();
        }
      } catch (err) {
        this.log.error(this.cameraName, 'Error occurred terminating Eufy Station livestream: ' + err);
      }

      this.ongoingSessions.delete(sessionId);
      this.log.info(this.cameraName, 'Stopped video stream.');
    } else {
      this.log.debug('No session to stop.');
    }
  }

  // Adjust our probe hints.
  public adjustProbeSize(): void {
    if (this.probesizeOverrideTimeout) {
      clearTimeout(this.probesizeOverrideTimeout);
      this.probesizeOverrideTimeout = undefined;
    }

    // Maintain statistics on how often we need to adjust our probesize. If this happens too frequently, we will default to a working value.
    this.probesizeOverrideCount++;

    // Increase the probesize by a factor of two each time we need to do something about it. This idea is to balance the latency implications
    // for the user, but also ensuring we have a functional streaming experience.
    this.probesizeOverride = this.probesize * 2;

    // Safety check to make sure this never gets too crazy.
    if (this.probesizeOverride > 5000000) {
      this.probesizeOverride = 5000000;
    }

    this.log.error('The FFmpeg process ended unexpectedly due to issues with the media stream provided by the UniFi Protect livestream API. ' +
      'Adjusting the settings we use for FFmpeg %s to use safer values at the expense of some additional streaming startup latency.',
      this.probesizeOverrideCount < 10 ? 'temporarily' : 'permanently');

    // If this happens often enough, keep the override in place permanently.
    if (this.probesizeOverrideCount < 10) {

      this.probesizeOverrideTimeout = setTimeout(() => {

        this.probesizeOverride = 0;
        this.probesizeOverrideTimeout = undefined;
      }, 1000 * 60 * 10);
    }
  }

  // Utility to return the currently set probesize for a camera.
  public get probesize(): number {
    return this.probesizeOverride ? this.probesizeOverride : 16384;
  }
}