/**
 * Meetrix WebRTC Core SDK - Audio Activity & Voice Activity Detector (VAD)
 * Analyzes microphone audio streams using Web Audio API to report real-time levels and speech state.
 */

import { AudioActivityConfig } from './types';

export type AudioLevelListener = (level: number) => void;
export type SpeakingChangeListener = (isSpeaking: boolean) => void;

export class AudioActivityDetector {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private isSpeaking = false;
  private lastSpokeTime = 0;
  private closed = false;

  private onAudioLevelListeners: Set<AudioLevelListener> = new Set();
  private onSpeakingChangeListeners: Set<SpeakingChangeListener> = new Set();

  private readonly threshold: number;
  private readonly intervalMs: number;
  private readonly smoothingTimeConstant: number;
  private readonly speakingHoldMs: number;

  constructor(
    private readonly track: MediaStreamTrack,
    config: AudioActivityConfig = {}
  ) {
    this.threshold = config.threshold ?? 0.05;
    this.intervalMs = config.intervalMs ?? 50;
    this.smoothingTimeConstant = config.smoothingTimeConstant ?? 0.8;
    this.speakingHoldMs = config.speakingHoldMs ?? 300;

    this.initAudioContext();
  }

  private initAudioContext(): void {
    const AudioContextClass =
      typeof window !== 'undefined'
        ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;

    if (!AudioContextClass) {
      return;
    }

    try {
      this.audioContext = new AudioContextClass();
      const stream = new MediaStream([this.track]);
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = this.smoothingTimeConstant;

      this.sourceNode.connect(this.analyserNode);

      this.startPolling();
    } catch (err) {
      console.warn('Failed to initialize AudioActivityDetector:', err);
    }
  }

  private startPolling(): void {
    if (!this.analyserNode) return;

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

    this.timerId = setInterval(() => {
      if (this.closed || !this.analyserNode || !this.track.enabled || this.track.readyState !== 'live') {
        if (this.isSpeaking) {
          this.setSpeaking(false);
        }
        this.emitAudioLevel(0);
        return;
      }

      this.analyserNode.getByteFrequencyData(dataArray);

      // Compute root-mean-square average of frequency bins
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      // Normalize from 0-255 to 0.0-1.0
      const normalizedLevel = Math.min(1.0, Math.max(0.0, average / 128));

      this.emitAudioLevel(normalizedLevel);

      const now = Date.now();
      if (normalizedLevel >= this.threshold) {
        this.lastSpokeTime = now;
        if (!this.isSpeaking) {
          this.setSpeaking(true);
        }
      } else if (this.isSpeaking && now - this.lastSpokeTime > this.speakingHoldMs) {
        this.setSpeaking(false);
      }
    }, this.intervalMs);
  }

  private setSpeaking(speaking: boolean): void {
    this.isSpeaking = speaking;
    for (const listener of this.onSpeakingChangeListeners) {
      try {
        listener(speaking);
      } catch (e) {
        console.error('Error in speaking change listener:', e);
      }
    }
  }

  private emitAudioLevel(level: number): void {
    for (const listener of this.onAudioLevelListeners) {
      try {
        listener(level);
      } catch (e) {
        console.error('Error in audio level listener:', e);
      }
    }
  }

  public onAudioLevel(listener: AudioLevelListener): () => void {
    this.onAudioLevelListeners.add(listener);
    return () => this.onAudioLevelListeners.delete(listener);
  }

  public onSpeakingChange(listener: SpeakingChangeListener): () => void {
    this.onSpeakingChangeListeners.add(listener);
    return () => this.onSpeakingChangeListeners.delete(listener);
  }

  public getSpeaking(): boolean {
    return this.isSpeaking;
  }

  public close(): void {
    this.closed = true;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }
    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {}
      this.analyserNode = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        void this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
    this.onAudioLevelListeners.clear();
    this.onSpeakingChangeListeners.clear();
  }
}

