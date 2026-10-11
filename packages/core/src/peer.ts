/**
 * Meetrix WebRTC Core SDK - Remote Peer Model
 * Represents a remote participant connected to the room, tracking their media streams,
 * state (muted, hand raised, screen sharing), role, and voice activity.
 */

import {
  Role,
  UserPermissions,
  ParticipantInfo,
  TrackPublication,
  TrackSource,
} from './types';
import { AudioActivityDetector } from './audio-activity';
import { TypedEventEmitter } from './events';

export type PeerEventMap = {
  trackSubscribed: (publication: TrackPublication) => void;
  trackUnsubscribed: (publication: TrackPublication) => void;
  audioMutedChange: (muted: boolean) => void;
  videoMutedChange: (muted: boolean) => void;
  screenSharingChange: (sharing: boolean) => void;
  handRaisedChange: (raised: boolean) => void;
  speakingChange: (isSpeaking: boolean) => void;
  audioLevelChange: (level: number) => void;
  roleChange: (role: Role) => void;
};

export class RemotePeer extends TypedEventEmitter<PeerEventMap> {
  public readonly id: string;
  public readonly userId: string;
  public displayName: string;
  public role: Role;
  public permissions: UserPermissions;
  public isInLobby: boolean;
  public audioMuted: boolean;
  public videoMuted: boolean;
  public screenSharing: boolean;
  public handRaised: boolean;
  public readonly joinedAt: Date;

  public isSpeaking: boolean = false;
  public audioLevel: number = 0;

  private _tracks: Map<string, TrackPublication> = new Map();
  private _stream: MediaStream = new MediaStream();
  private _audioDetector: AudioActivityDetector | null = null;

  constructor(info: ParticipantInfo) {
    super();
    this.id = info.id;
    this.userId = info.user_id;
    this.displayName = info.display_name;
    this.role = info.role;
    this.permissions = info.permissions;
    this.isInLobby = info.is_in_lobby;
    this.audioMuted = info.audio_muted;
    this.videoMuted = info.video_muted;
    this.screenSharing = info.screen_sharing;
    this.handRaised = info.hand_raised;
    this.joinedAt = info.joined_at ? new Date(info.joined_at) : new Date();
  }

  public get stream(): MediaStream {
    return this._stream;
  }

  public get tracks(): Map<string, TrackPublication> {
    return new Map(this._tracks);
  }

  public getAudioTrack(): MediaStreamTrack | null {
    for (const pub of this._tracks.values()) {
      if (pub.kind === 'audio' && pub.source !== 'screen_audio') {
        return pub.track;
      }
    }
    return null;
  }

  public getVideoTrack(): MediaStreamTrack | null {
    for (const pub of this._tracks.values()) {
      if (pub.kind === 'video' && pub.source === 'camera') {
        return pub.track;
      }
    }
    return null;
  }

  public getScreenTrack(): MediaStreamTrack | null {
    for (const pub of this._tracks.values()) {
      if (pub.kind === 'video' && pub.source === 'screen') {
        return pub.track;
      }
    }
    return null;
  }

  public getScreenAudioTrack(): MediaStreamTrack | null {
    for (const pub of this._tracks.values()) {
      if (pub.kind === 'audio' && pub.source === 'screen_audio') {
        return pub.track;
      }
    }
    return null;
  }

  public getTracks(): TrackPublication[] {
    return Array.from(this._tracks.values());
  }

  /**
   * Attach a newly received remote media track to this peer.
   */
  public addTrack(
    track: MediaStreamTrack,
    source?: TrackSource
  ): TrackPublication {
    let inferredSource: TrackSource;
    if (source) {
      inferredSource = source;
    } else if (track.kind === 'audio') {
      inferredSource = 'microphone';
    } else {
      const hasCamera = !!this.getVideoTrack();
      const hasScreen = !!this.getScreenTrack();
      if (!hasCamera && !hasScreen) {
        inferredSource = this.screenSharing ? 'screen' : 'camera';
      } else if (hasCamera && !hasScreen) {
        inferredSource = 'screen';
      } else {
        inferredSource = 'camera';
      }
    }

    const publication: TrackPublication = {
      id: track.id,
      kind: track.kind as 'audio' | 'video',
      source: inferredSource,
      track,
      stream: this._stream,
      isMuted: !track.enabled,
    };

    this._tracks.set(track.id, publication);
    this._stream.addTrack(track);

    // If audio track, set up voice activity detection (skip screen_audio)
    if (track.kind === 'audio' && inferredSource !== 'screen_audio') {
      if (this._audioDetector) {
        this._audioDetector.close();
      }
      this._audioDetector = new AudioActivityDetector(track);
      this._audioDetector.onAudioLevel((lvl) => {
        this.audioLevel = lvl;
        this.emit('audioLevelChange', lvl);
      });
      this._audioDetector.onSpeakingChange((speaking) => {
        this.isSpeaking = speaking;
        this.emit('speakingChange', speaking);
      });
    }

    this.emit('trackSubscribed', publication);
    return publication;
  }

  /**
   * Remove a track from this peer.
   */
  public removeTrack(trackOrId: MediaStreamTrack | string): void {
    const trackId = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
    const publication = this._tracks.get(trackId);
    if (!publication) {
      return;
    }

    this._tracks.delete(trackId);
    try {
      this._stream.removeTrack(publication.track);
    } catch {}

    if (publication.kind === 'audio' && this._audioDetector) {
      this._audioDetector.close();
      this._audioDetector = null;
      this.isSpeaking = false;
      this.audioLevel = 0;
    }

    this.emit('trackUnsubscribed', publication);
  }

  /**
   * Update internal state from ParticipantInfo snapshot received from signaling.
   */
  public updateFromInfo(info: ParticipantInfo): void {
    if (this.displayName !== info.display_name) {
      this.displayName = info.display_name;
    }
    if (this.role !== info.role) {
      this.role = info.role;
      this.emit('roleChange', info.role);
    }
    this.permissions = info.permissions;
    this.isInLobby = info.is_in_lobby;

    this.setAudioMuted(info.audio_muted);
    this.setVideoMuted(info.video_muted);
    this.setScreenSharing(info.screen_sharing);
    this.setHandRaised(info.hand_raised);
  }

  public setAudioMuted(muted: boolean): void {
    if (this.audioMuted !== muted) {
      this.audioMuted = muted;
      this.emit('audioMutedChange', muted);
    }
  }

  public setVideoMuted(muted: boolean): void {
    if (this.videoMuted !== muted) {
      this.videoMuted = muted;
      this.emit('videoMutedChange', muted);
    }
  }

  public setScreenSharing(sharing: boolean): void {
    if (this.screenSharing !== sharing) {
      this.screenSharing = sharing;
      this.emit('screenSharingChange', sharing);
    }
  }

  public setHandRaised(raised: boolean): void {
    if (this.handRaised !== raised) {
      this.handRaised = raised;
      this.emit('handRaisedChange', raised);
    }
  }

  public setRole(role: Role): void {
    if (this.role !== role) {
      this.role = role;
      this.emit('roleChange', role);
    }
  }

  public close(): void {
    if (this._audioDetector) {
      this._audioDetector.close();
      this._audioDetector = null;
    }

    for (const pub of this._tracks.values()) {
      try {
        this._stream.removeTrack(pub.track);
      } catch {}
    }
    this._tracks.clear();
    this.removeAllListeners();
  }
}

