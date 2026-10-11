/**
 * Meetrix WebRTC Core SDK - Local Media Management
 * Handles browser media capture (getUserMedia, getDisplayMedia), device enumeration,
 * track muting, switching, and audio activity detection.
 */

import {
  CameraOptions,
  MicrophoneOptions,
  ScreenShareOptions,
  MediaDevice,
  VideoResolutionPreset,
} from './types';
import { MediaDeviceError } from './errors';
import { AudioActivityDetector } from './audio-activity';

export const RESOLUTION_CONSTRAINTS: Record<
  VideoResolutionPreset,
  MediaTrackConstraints
> = {
  '360p': {
    width: { ideal: 640 },
    height: { ideal: 360 },
    frameRate: { ideal: 24 },
  },
  '480p': {
    width: { ideal: 854 },
    height: { ideal: 480 },
    frameRate: { ideal: 30 },
  },
  '720p': {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  },
  '1080p': {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
  },
  '4k': {
    width: { ideal: 3840 },
    height: { ideal: 2160 },
    frameRate: { ideal: 30 },
  },
};

export class LocalMediaManager {
  private _cameraTrack: MediaStreamTrack | null = null;
  private _microphoneTrack: MediaStreamTrack | null = null;
  private _screenTrack: MediaStreamTrack | null = null;
  private _screenAudioTrack: MediaStreamTrack | null = null;

  private _cameraStream: MediaStream = new MediaStream();
  private _microphoneStream: MediaStream = new MediaStream();
  private _screenStream: MediaStream | null = null;

  private _audioDetector: AudioActivityDetector | null = null;

  private _onDeviceChangeListener: (() => void) | null = null;

  constructor() {
    this.setupDeviceChangeListener();
  }

  private setupDeviceChangeListener(): void {
    if (
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      'ondevicechange' in navigator.mediaDevices
    ) {
      this._onDeviceChangeListener = () => {
        // Can be hooked by consumers
      };
      navigator.mediaDevices.ondevicechange = this._onDeviceChangeListener;
    }
  }

  // ==========================================
  // Getters
  // ==========================================

  public get cameraTrack(): MediaStreamTrack | null {
    return this._cameraTrack;
  }

  public get microphoneTrack(): MediaStreamTrack | null {
    return this._microphoneTrack;
  }

  public get screenTrack(): MediaStreamTrack | null {
    return this._screenTrack;
  }

  public get screenAudioTrack(): MediaStreamTrack | null {
    return this._screenAudioTrack;
  }

  public get cameraStream(): MediaStream {
    return this._cameraStream;
  }

  public get microphoneStream(): MediaStream {
    return this._microphoneStream;
  }

  public get screenStream(): MediaStream | null {
    return this._screenStream;
  }

  public get audioDetector(): AudioActivityDetector | null {
    return this._audioDetector;
  }

  public isCameraMuted(): boolean {
    return !this._cameraTrack || !this._cameraTrack.enabled;
  }

  public isMicrophoneMuted(): boolean {
    return !this._microphoneTrack || !this._microphoneTrack.enabled;
  }

  public isScreenSharing(): boolean {
    return !!this._screenTrack && this._screenTrack.readyState === 'live';
  }

  // ==========================================
  // Device Enumeration
  // ==========================================

  public static async getDevices(): Promise<MediaDevice[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `${d.kind} (${d.deviceId.slice(0, 5)})`,
        kind: d.kind,
        groupId: d.groupId,
      }));
    } catch (err) {
      throw new MediaDeviceError(
        `Failed to enumerate devices: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public static async getCameras(): Promise<MediaDevice[]> {
    const devices = await LocalMediaManager.getDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  public static async getMicrophones(): Promise<MediaDevice[]> {
    const devices = await LocalMediaManager.getDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  public static async getSpeakers(): Promise<MediaDevice[]> {
    const devices = await LocalMediaManager.getDevices();
    return devices.filter((d) => d.kind === 'audiooutput');
  }

  // ==========================================
  // Camera Capture
  // ==========================================

  public async startCamera(options: CameraOptions = {}): Promise<MediaStreamTrack> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new MediaDeviceError('getUserMedia is not supported in this environment');
    }

    // Stop existing camera track if active
    if (this._cameraTrack) {
      this.stopCamera();
    }

    const videoConstraints: MediaTrackConstraints = {};

    if (options.deviceId) {
      videoConstraints.deviceId = { exact: options.deviceId };
    }
    if (options.facingMode) {
      videoConstraints.facingMode = options.facingMode;
    }
    if (options.frameRate) {
      videoConstraints.frameRate = { ideal: options.frameRate };
    }

    if (options.resolution) {
      if (typeof options.resolution === 'string') {
        const preset = RESOLUTION_CONSTRAINTS[options.resolution];
        if (preset) {
          Object.assign(videoConstraints, preset);
        }
      } else {
        Object.assign(videoConstraints, options.resolution);
      }
    } else {
      // Default to 720p
      Object.assign(videoConstraints, RESOLUTION_CONSTRAINTS['720p']);
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      const track = stream.getVideoTracks()[0];
      if (!track) {
        throw new MediaDeviceError('No video track returned by getUserMedia');
      }

      this._cameraTrack = track;
      this._cameraStream = stream;

      track.onended = () => {
        this.stopCamera();
      };

      return track;
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError' || errMsg.includes('not be found')) {
        throw new MediaDeviceError('No camera device found on this system. Please connect a webcam.');
      } else if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        throw new MediaDeviceError('Camera access was denied. Please allow camera permissions in your browser.');
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        throw new MediaDeviceError('Camera is already in use by another application or process.');
      }
      throw new MediaDeviceError(`Failed to start camera: ${errMsg}`);
    }
  }

  public stopCamera(): void {
    if (this._cameraTrack) {
      this._cameraTrack.stop();
      this._cameraTrack = null;
    }
    this._cameraStream = new MediaStream();
  }

  public setCameraMuted(muted: boolean): void {
    if (this._cameraTrack) {
      this._cameraTrack.enabled = !muted;
    }
  }

  public async switchCamera(deviceId: string, options: CameraOptions = {}): Promise<MediaStreamTrack> {
    const wasMuted = this.isCameraMuted();
    const newTrack = await this.startCamera({ ...options, deviceId });
    if (wasMuted) {
      newTrack.enabled = false;
    }
    return newTrack;
  }

  // ==========================================
  // Microphone Capture
  // ==========================================

  public async startMicrophone(options: MicrophoneOptions = {}): Promise<MediaStreamTrack> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new MediaDeviceError('getUserMedia is not supported in this environment');
    }

    // Stop existing microphone track if active
    if (this._microphoneTrack) {
      this.stopMicrophone();
    }

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: options.echoCancellation ?? true,
      noiseSuppression: options.noiseSuppression ?? true,
      autoGainControl: options.autoGainControl ?? true,
    };
    (audioConstraints as unknown as Record<string, unknown>).latency = 0;

    if (options.deviceId) {
      audioConstraints.deviceId = { exact: options.deviceId };
    }
    if (options.sampleRate) {
      audioConstraints.sampleRate = options.sampleRate;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });

      const track = stream.getAudioTracks()[0];
      if (!track) {
        throw new MediaDeviceError('No audio track returned by getUserMedia');
      }

      this._microphoneTrack = track;
      this._microphoneStream = stream;

      track.onended = () => {
        this.stopMicrophone();
      };

      // Set up Audio Activity Detector
      this._audioDetector = new AudioActivityDetector(track);

      return track;
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError' || errMsg.includes('not be found')) {
        throw new MediaDeviceError('No microphone found on this system. Please connect an audio input device.');
      } else if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        throw new MediaDeviceError('Microphone access was denied. Please allow microphone permissions in your browser.');
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        throw new MediaDeviceError('Microphone is already in use by another application or process.');
      }
      throw new MediaDeviceError(`Failed to start microphone: ${errMsg}`);
    }
  }

  public stopMicrophone(): void {
    if (this._audioDetector) {
      this._audioDetector.close();
      this._audioDetector = null;
    }
    if (this._microphoneTrack) {
      this._microphoneTrack.stop();
      this._microphoneTrack = null;
    }
    this._microphoneStream = new MediaStream();
  }

  public setMicrophoneMuted(muted: boolean): void {
    if (this._microphoneTrack) {
      this._microphoneTrack.enabled = !muted;
    }
  }

  public async switchMicrophone(deviceId: string, options: MicrophoneOptions = {}): Promise<MediaStreamTrack> {
    const wasMuted = this.isMicrophoneMuted();
    const newTrack = await this.startMicrophone({ ...options, deviceId });
    if (wasMuted) {
      newTrack.enabled = false;
    }
    return newTrack;
  }

  // ==========================================
  // Screen Sharing Capture
  // ==========================================

  public async startScreenShare(
    options: ScreenShareOptions = {},
    onEnded?: () => void
  ): Promise<MediaStreamTrack> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      throw new MediaDeviceError('getDisplayMedia is not supported in this environment');
    }

    if (this._screenTrack) {
      this.stopScreenShare();
    }

    const displayConstraints: DisplayMediaStreamOptions = {
      video: options.video ?? true,
      audio: options.audio ?? true,
    };

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
      const track = stream.getVideoTracks()[0];
      if (!track) {
        throw new MediaDeviceError('No video track returned by getDisplayMedia');
      }

      this._screenTrack = track;
      this._screenStream = stream;

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        this._screenAudioTrack = audioTracks[0];
      }

      track.onended = () => {
        this.stopScreenShare();
        onEnded?.();
      };

      return track;
    } catch (err) {
      throw new MediaDeviceError(
        `Failed to start screen share: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public stopScreenShare(): void {
    if (this._screenTrack) {
      this._screenTrack.stop();
      this._screenTrack = null;
    }
    if (this._screenAudioTrack) {
      this._screenAudioTrack.stop();
      this._screenAudioTrack = null;
    }
    this._screenStream = null;
  }

  // ==========================================
  // Cleanup
  // ==========================================

  public close(): void {
    this.stopCamera();
    this.stopMicrophone();
    this.stopScreenShare();

    if (
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      this._onDeviceChangeListener
    ) {
      navigator.mediaDevices.removeEventListener?.('devicechange', this._onDeviceChangeListener);
      this._onDeviceChangeListener = null;
    }
  }
}

