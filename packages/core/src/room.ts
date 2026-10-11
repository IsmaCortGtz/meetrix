/**
 * Meetrix WebRTC Core SDK - MeetrixRoom
 * The primary entry point for managing conference rooms, local/remote media,
 * signaling lifecycle, real-time chat, emoji reactions, and host moderation.
 */

import {
  Role,
  RoomPolicy,
  UserPermissions,
  JoinedPayload,
  ParticipantInfo,
  ChatBroadcastPayload,
  ReactionBroadcastPayload,
  HandRaisedBroadcastPayload,
  RoomConnectionState,
  JoinOptions,
  CameraOptions,
  MicrophoneOptions,
  ScreenShareOptions,
  TrackPublication,
  TrackSource,
  MediaStateChangedPayload,
  ModerationActionEvent,
} from './types';
import { TypedEventEmitter } from './events';
import { SignalingClient, SignalingClientOptions } from './signaling';
import { WebRTCManager } from './webrtc';
import { LocalMediaManager } from './local-media';
import { RemotePeer } from './peer';
import { ModerationController } from './moderation';
import { RoomError, PermissionError } from './errors';

export type RoomEventMap = {
  connected: (info: JoinedPayload) => void;
  disconnected: (reason?: string) => void;
  reconnecting: (attempt: number) => void;
  reconnected: () => void;
  participantJoined: (peer: RemotePeer) => void;
  participantLeft: (peerId: string) => void;
  trackSubscribed: (track: MediaStreamTrack, publication: TrackPublication, peer: RemotePeer) => void;
  trackUnsubscribed: (track: MediaStreamTrack, publication: TrackPublication, peer: RemotePeer) => void;
  chatMessage: (message: ChatBroadcastPayload) => void;
  reaction: (reaction: ReactionBroadcastPayload) => void;
  handRaised: (payload: HandRaisedBroadcastPayload) => void;
  policyUpdated: (policy: RoomPolicy) => void;
  moderationAction: (action: ModerationActionEvent) => void;
  sessionTimerTick: (remainingSeconds: number) => void;
  sessionEnded: (reason: string) => void;
  lobbyWaiting: (message: string) => void;
  lobbyPeerWaiting: (peer: ParticipantInfo) => void;
  activeSpeakerChanged: (speakers: string[]) => void;
  peerMediaChanged: (peer: RemotePeer, state: MediaStateChangedPayload) => void;
  error: (err: Error) => void;
};

export class LocalParticipant {
  public id: string = '';
  public userId: string = '';
  public displayName: string = '';
  public role: Role = 'participant';
  public permissions: UserPermissions = {
    can_publish_audio: true,
    can_publish_video: true,
    can_publish_screen: true,
    can_chat: true,
    can_react: true,
  };
  public handRaised: boolean = false;

  constructor(
    private readonly media: LocalMediaManager,
    private readonly webrtc: WebRTCManager,
    private readonly signaling: SignalingClient,
    private readonly isInRoom: () => boolean,
    private readonly getRemotePeers?: () => Map<string, RemotePeer>,
    private readonly getRoomPolicy?: () => RoomPolicy
  ) {}

  public get cameraTrack(): MediaStreamTrack | null {
    return this.media.cameraTrack;
  }

  public get microphoneTrack(): MediaStreamTrack | null {
    return this.media.microphoneTrack;
  }

  public get screenTrack(): MediaStreamTrack | null {
    return this.media.screenTrack;
  }

  public get isCameraMuted(): boolean {
    return this.media.isCameraMuted();
  }

  public get isMicrophoneMuted(): boolean {
    return this.media.isMicrophoneMuted();
  }

  public get isScreenSharing(): boolean {
    return this.media.isScreenSharing();
  }

  public get audioLevel(): number {
    return this.media.audioDetector?.getSpeaking() ? 0.5 : 0;
  }

  public get isSpeaking(): boolean {
    return this.media.audioDetector?.getSpeaking() ?? false;
  }

  public async enableCamera(options?: CameraOptions): Promise<MediaStreamTrack> {
    const track = await this.media.startCamera(options);
    if (this.isInRoom()) {
      await this.webrtc.publishTrack(track, this.media.cameraStream);
      this.signaling.sendMediaStateChanged({ video_muted: false });
    }
    return track;
  }

  public async disableCamera(): Promise<void> {
    const track = this.media.cameraTrack;
    if (track && this.isInRoom()) {
      await this.webrtc.unpublishTrack(track);
      this.signaling.sendMediaStateChanged({ video_muted: true });
    }
    this.media.stopCamera();
  }

  public setCameraMuted(muted: boolean): void {
    this.media.setCameraMuted(muted);
    if (this.isInRoom()) {
      this.signaling.sendMediaStateChanged({ video_muted: muted });
    }
  }

  public async enableMicrophone(options?: MicrophoneOptions): Promise<MediaStreamTrack> {
    const track = await this.media.startMicrophone(options);
    if (this.isInRoom()) {
      await this.webrtc.publishTrack(track, this.media.microphoneStream);
      this.signaling.sendMediaStateChanged({ audio_muted: false });
    }
    return track;
  }

  public async disableMicrophone(): Promise<void> {
    const track = this.media.microphoneTrack;
    if (track && this.isInRoom()) {
      await this.webrtc.unpublishTrack(track);
      this.signaling.sendMediaStateChanged({ audio_muted: true });
    }
    this.media.stopMicrophone();
  }

  public setMicrophoneMuted(muted: boolean): void {
    this.media.setMicrophoneMuted(muted);
    if (this.isInRoom()) {
      this.signaling.sendMediaStateChanged({ audio_muted: muted });
    }
  }

  public async startScreenShare(
    options?: ScreenShareOptions,
    onEnded?: () => void
  ): Promise<MediaStreamTrack> {
    if (this.isInRoom()) {
      // 1. Check if another participant is already sharing screen
      const peers = this.getRemotePeers?.() || new Map();
      for (const peer of peers.values()) {
        if (peer.screenSharing) {
          throw new RoomError(`Cannot share screen: ${peer.displayName || 'Another participant'} is already sharing their screen.`);
        }
      }

      // 2. Check room policy
      const policy = this.getRoomPolicy?.();
      if (policy && !policy.allow_screen_share && this.role !== 'host' && this.role !== 'co-host') {
        throw new PermissionError('Screen sharing is disabled by meeting policy');
      }
    }

    const track = await this.media.startScreenShare(options, async () => {
      if (this.isInRoom()) {
        if (track) {
          await this.webrtc.unpublishTrack(track);
        }
        if (screenAudioTrack) {
          await this.webrtc.unpublishTrack(screenAudioTrack);
        }
        this.signaling.sendMediaStateChanged({ screen_sharing: false });
      }
      onEnded?.();
    });

    const screenAudioTrack = this.media.screenAudioTrack;

    if (this.isInRoom() && this.media.screenStream) {
      await this.webrtc.publishTrack(track, this.media.screenStream);
      if (this.media.screenAudioTrack) {
        await this.webrtc.publishTrack(this.media.screenAudioTrack, this.media.screenStream);
      }
      this.signaling.sendMediaStateChanged({ screen_sharing: true, screen_track_id: track.id });
    }
    return track;
  }

  public async stopScreenShare(): Promise<void> {
    const track = this.media.screenTrack;
    const screenAudioTrack = this.media.screenAudioTrack;
    if (track && this.isInRoom()) {
      await this.webrtc.unpublishTrack(track);
      if (screenAudioTrack) {
        await this.webrtc.unpublishTrack(screenAudioTrack);
      }
      this.signaling.sendMediaStateChanged({ screen_sharing: false });
    }
    this.media.stopScreenShare();
  }

  public async switchCamera(deviceId: string, options?: CameraOptions): Promise<MediaStreamTrack> {
    const oldTrackId = this.media.cameraTrack?.id;
    const newTrack = await this.media.switchCamera(deviceId, options);
    if (oldTrackId && this.isInRoom()) {
      await this.webrtc.replaceTrack(oldTrackId, newTrack);
    }
    return newTrack;
  }

  public async switchMicrophone(deviceId: string, options?: MicrophoneOptions): Promise<MediaStreamTrack> {
    const oldTrackId = this.media.microphoneTrack?.id;
    const newTrack = await this.media.switchMicrophone(deviceId, options);
    if (oldTrackId && this.isInRoom()) {
      await this.webrtc.replaceTrack(oldTrackId, newTrack);
    }
    return newTrack;
  }
}

export class MeetrixRoom extends TypedEventEmitter<RoomEventMap> {
  private _state: RoomConnectionState = 'disconnected';
  private _roomId: string = '';
  private _sessionRemainingSec: number = 0;
  private _policy: RoomPolicy = {
    allow_camera: true,
    allow_mic: true,
    allow_screen_share: true,
    allow_chat: true,
    allow_reactions: true,
    require_lobby: false,
  };

  public readonly localMedia: LocalMediaManager;
  public readonly signaling: SignalingClient;
  public readonly webrtc: WebRTCManager;
  public readonly localParticipant: LocalParticipant;
  public readonly moderation: ModerationController;

  private _remoteParticipants: Map<string, RemotePeer> = new Map();
  private pendingRemoteTracks: Map<string, Array<{ track: MediaStreamTrack; source: TrackSource }>> = new Map();

  constructor(signalingOptions?: SignalingClientOptions) {
    super();
    this.localMedia = new LocalMediaManager();
    this.signaling = new SignalingClient(signalingOptions);
    this.webrtc = new WebRTCManager(this.signaling);

    this.localParticipant = new LocalParticipant(
      this.localMedia,
      this.webrtc,
      this.signaling,
      () => this._state === 'connected',
      () => this._remoteParticipants,
      () => this.policy
    );

    this.moderation = new ModerationController(
      this.signaling,
      () => this.localParticipant.role,
      (peerId) => this._remoteParticipants.get(peerId)?.role
    );

    this.setupSignalingEvents();
    this.setupWebRTCEvents();
  }

  // ==========================================
  // Getters
  // ==========================================

  public get state(): RoomConnectionState {
    return this._state;
  }

  public get roomId(): string {
    return this._roomId;
  }

  public get sessionRemainingSec(): number {
    return this._sessionRemainingSec;
  }

  public get policy(): RoomPolicy {
    return { ...this._policy };
  }

  public get remoteParticipants(): Map<string, RemotePeer> {
    return new Map(this._remoteParticipants);
  }

  // ==========================================
  // Chat & Reactions Sub-APIs
  // ==========================================

  public readonly chat = {
    sendMessage: async (text: string): Promise<void> => {
      if (!this._policy.allow_chat && this.localParticipant.role === 'participant') {
        throw new RoomError('Chat is currently disabled by host policy');
      }
      this.signaling.sendChatMessage({ text });
    },
    sendPrivateMessage: async (peerId: string, text: string): Promise<void> => {
      // In current signaling protocol, chat messages are broadcast; include metadata if supported
      this.signaling.sendChatMessage({ text: `[@${peerId}]: ${text}` });
    },
  };

  public readonly reactions = {
    sendReaction: (emoji: string): void => {
      if (!this._policy.allow_reactions && this.localParticipant.role === 'participant') {
        return;
      }
      this.signaling.sendReaction({ emoji });
    },
    raiseHand: (raised: boolean = true): void => {
      this.localParticipant.handRaised = raised;
      this.signaling.sendRaiseHand({ raised });
    },
  };

  // ==========================================
  // Lifecycle: Join & Leave
  // ==========================================

  /**
   * Connect and join a room.
   */
  public async join(options: JoinOptions): Promise<JoinedPayload> {
    if (this._state === 'connected' || this._state === 'connecting') {
      throw new RoomError('Room connection already in progress or connected');
    }

    this._state = 'connecting';
    this._roomId = options.roomId || '';

    // Handle initial media options
    if (options.mediaOptions?.camera) {
      const camOpts = typeof options.mediaOptions.camera === 'object' ? options.mediaOptions.camera : {};
      try {
        await this.localMedia.startCamera(camOpts);
      } catch (err) {
        console.warn('Initial camera capture failed:', err);
      }
    }

    if (options.mediaOptions?.microphone) {
      const micOpts = typeof options.mediaOptions.microphone === 'object' ? options.mediaOptions.microphone : {};
      try {
        await this.localMedia.startMicrophone(micOpts);
      } catch (err) {
        console.warn('Initial microphone capture failed:', err);
      }
    }

    return new Promise<JoinedPayload>((resolve, reject) => {
      let resolved = false;

      const onJoined = async (payload: JoinedPayload) => {
        if (resolved) return;
        resolved = true;

        this._state = 'connected';
        this.localParticipant.id = payload.peer_id;
        this.localParticipant.userId = payload.user_id;
        this.localParticipant.displayName = payload.display_name;
        this.localParticipant.role = payload.role;
        this.localParticipant.permissions = payload.permissions;

        const effectivePolicy = payload.policies || payload.room_policies;
        if (effectivePolicy) {
          this._policy = effectivePolicy;
        }
        this._sessionRemainingSec = payload.session_remaining_sec;

        // Initialize WebRTC with received ICE servers
        this.webrtc.initialize(payload.ice_servers || []);

        // Publish existing local tracks if enabled
        if (this.localMedia.cameraTrack && this.localMedia.cameraStream) {
          try {
            await this.webrtc.publishTrack(this.localMedia.cameraTrack, this.localMedia.cameraStream);
          } catch (e) {
            console.warn('Failed to publish initial camera track:', e);
          }
        }
        if (this.localMedia.microphoneTrack && this.localMedia.microphoneStream) {
          try {
            await this.webrtc.publishTrack(this.localMedia.microphoneTrack, this.localMedia.microphoneStream);
          } catch (e) {
            console.warn('Failed to publish initial microphone track:', e);
          }
        }

        // Initialize remote peers
        for (const part of payload.participants) {
          if (part.id !== payload.peer_id) {
            const peer = new RemotePeer(part);
            this._remoteParticipants.set(part.id, peer);
            this.setupRemotePeerListeners(peer);
            this.attachPendingTracksForPeer(peer);
          }
        }

        this.emit('connected', payload);
        resolve(payload);
      };

      const onLobbyWaiting = (payload: { message: string }) => {
        this._state = 'lobby';
        this.emit('lobbyWaiting', payload.message);
      };

      const onError = (err: Error) => {
        if (!resolved) {
          resolved = true;
          this._state = 'failed';
          this.cleanup();
          reject(err);
        }
      };

      this.signaling.once('joined', onJoined);
      this.signaling.once('lobby_waiting', onLobbyWaiting);
      this.signaling.once('error', onError);

      // Connect signaling WebSocket
      this.signaling.connect(options.url).then(() => {
        this.signaling.sendJoin({
          room_id: options.roomId || '',
          token: options.token,
          user_id: options.userId,
          display_name: options.displayName,
          metadata: options.metadata,
        });
      }).catch((err) => {
        if (!resolved) {
          resolved = true;
          this._state = 'failed';
          this.cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * Leave the room gracefully.
   */
  public async leave(): Promise<void> {
    if (this._state === 'disconnected') {
      return;
    }

    try {
      this.signaling.sendLeave();
    } catch {}

    this.cleanup();
    this.emit('disconnected', 'User left the room');
  }

  private cleanup(): void {
    this._state = 'disconnected';
    this.signaling.disconnect();
    this.webrtc.close();
    this.localMedia.close();

    for (const peer of this._remoteParticipants.values()) {
      peer.close();
    }
    this._remoteParticipants.clear();
    this.pendingRemoteTracks.clear();
  }

  // ==========================================
  // Signaling Event Bindings
  // ==========================================

  private setupSignalingEvents(): void {
    this.signaling.on('reconnecting', (attempt) => {
      this._state = 'reconnecting';
      this.emit('reconnecting', attempt);
    });

    this.signaling.on('reconnected', () => {
      this._state = 'connected';
      this.emit('reconnected');
    });

    this.signaling.on('peer_joined', (payload) => {
      const peer = new RemotePeer(payload.peer);
      this._remoteParticipants.set(peer.id, peer);
      this.setupRemotePeerListeners(peer);
      this.attachPendingTracksForPeer(peer);
      this.emit('participantJoined', peer);
    });

    this.signaling.on('peer_left', (payload) => {
      this.pendingRemoteTracks.delete(payload.peer_id);
      const peer = this._remoteParticipants.get(payload.peer_id);
      if (peer) {
        peer.close();
        this._remoteParticipants.delete(payload.peer_id);
      }
      this.emit('participantLeft', payload.peer_id);
    });

    this.signaling.on('chat_message', (payload) => {
      this.emit('chatMessage', payload);
    });

    this.signaling.on('reaction', (payload) => {
      this.emit('reaction', payload);
    });

    this.signaling.on('hand_raised', (payload) => {
      if (payload.peer_id === this.localParticipant.id) {
        this.localParticipant.handRaised = payload.raised;
      } else {
        const peer = this._remoteParticipants.get(payload.peer_id);
        if (peer) {
          peer.setHandRaised(payload.raised);
        }
      }
      this.emit('handRaised', payload);
    });

    this.signaling.on('policy_updated', (payload) => {
      this._policy = payload.policies;

      // Enforce policies on local participant if not host
      if (this.localParticipant.role === 'participant') {
        if (!payload.policies.allow_camera && !this.localParticipant.isCameraMuted) {
          this.localParticipant.setCameraMuted(true);
        }
        if (!payload.policies.allow_mic && !this.localParticipant.isMicrophoneMuted) {
          this.localParticipant.setMicrophoneMuted(true);
        }
        if (!payload.policies.allow_screen_share && this.localParticipant.isScreenSharing) {
          void this.localParticipant.stopScreenShare();
        }
      }

      this.emit('policyUpdated', payload.policies);
    });

    this.signaling.on('peer_muted', (payload) => {
      if (payload.peer_id === this.localParticipant.id) {
        if (payload.media === 'audio') {
          this.localParticipant.setMicrophoneMuted(true);
        } else if (payload.media === 'video') {
          this.localParticipant.setCameraMuted(true);
        }
      } else {
        const peer = this._remoteParticipants.get(payload.peer_id);
        if (peer) {
          if (payload.media === 'audio') peer.setAudioMuted(true);
          else if (payload.media === 'video') peer.setVideoMuted(true);
        }
      }

      this.emit('moderationAction', {
        action: 'mute',
        targetPeerId: payload.peer_id,
        byPeerId: payload.by_peer_id,
        media: payload.media,
      });
    });

    this.signaling.on('peer_media_stopped', (payload) => {
      if (payload.peer_id === this.localParticipant.id) {
        if (payload.media === 'screenshare') {
          void this.localParticipant.stopScreenShare();
        }
      } else {
        const peer = this._remoteParticipants.get(payload.peer_id);
        if (peer) {
          peer.setScreenSharing(false);
        }
      }

      this.emit('moderationAction', {
        action: 'stop_media',
        targetPeerId: payload.peer_id,
        byPeerId: payload.by_peer_id,
        media: payload.media,
      });
    });

    this.signaling.on('kicked', (payload) => {
      this.emit('moderationAction', {
        action: 'kick',
        targetPeerId: this.localParticipant.id,
        byPeerId: payload.by_peer_id,
        reason: payload.reason,
      });
      this.cleanup();
      this.emit('disconnected', payload.reason || 'Kicked by host');
    });

    this.signaling.on('lobby_peer_waiting', (payload) => {
      this.emit('lobbyPeerWaiting', payload.peer);
    });

    this.signaling.on('session_timer_tick', (payload) => {
      this._sessionRemainingSec = payload.remaining_sec;
      this.emit('sessionTimerTick', payload.remaining_sec);
    });

    this.signaling.on('session_ended', (payload) => {
      this.emit('sessionEnded', payload.reason);
      this.cleanup();
      this.emit('disconnected', payload.reason);
    });

    this.signaling.on('media_state_changed', (payload) => {
      const peer = this._remoteParticipants.get(payload.peer_id);
      if (peer) {
        if (payload.audio_muted !== undefined) {
          peer.setAudioMuted(payload.audio_muted);
        }
        if (payload.video_muted !== undefined) {
          peer.setVideoMuted(payload.video_muted);
        }
        if (payload.screen_sharing !== undefined) {
          peer.setScreenSharing(payload.screen_sharing);
          if (!payload.screen_sharing) {
            const screenTrack = peer.getScreenTrack();
            if (screenTrack) {
              peer.removeTrack(screenTrack.id);
            }
            const screenAudioTrack = peer.getScreenAudioTrack();
            if (screenAudioTrack) {
              peer.removeTrack(screenAudioTrack.id);
            }
          }
        }
        this.emit('peerMediaChanged', peer, payload);
      }
    });

    this.signaling.on('server_error', (payload) => {
      this.emit('error', new RoomError(`${payload.code}: ${payload.message}`));
    });

    this.signaling.on('error', (err) => {
      this.emit('error', err);
    });
  }

  // ==========================================
  // WebRTC Track Routing
  // ==========================================

  private setupWebRTCEvents(): void {
    this.webrtc.on('trackReceived', (track: MediaStreamTrack, stream: MediaStream, explicitStreamId?: string) => {
      let targetPeer: RemotePeer | undefined;
      let source: TrackSource | undefined;
      let explicitPeerId: string | undefined;

      const streamId = explicitStreamId || stream.id;

      // 1. Inspect streamId for explicit type hints
      if (streamId.includes(':screen')) {
        source = track.kind === 'audio' ? 'screen_audio' : 'screen';
        explicitPeerId = streamId.replace(':screen', '');
        targetPeer = this._remoteParticipants.get(explicitPeerId);
      } else if (streamId.includes(':camera')) {
        source = 'camera';
        explicitPeerId = streamId.replace(':camera', '');
        targetPeer = this._remoteParticipants.get(explicitPeerId);
      } else if (streamId.includes(':audio')) {
        source = 'microphone';
        explicitPeerId = streamId.replace(':audio', '');
        targetPeer = this._remoteParticipants.get(explicitPeerId);
      }

      // 2. Direct match by stream ID == peer.id or peer.userId
      if (!targetPeer && !explicitPeerId) {
        if (this._remoteParticipants.has(streamId)) {
          targetPeer = this._remoteParticipants.get(streamId);
          explicitPeerId = streamId;
          source = track.kind === 'video' ? 'camera' : 'microphone';
        } else {
          for (const peer of this._remoteParticipants.values()) {
            if (
              peer.id === streamId ||
              peer.userId === streamId ||
              streamId.startsWith(peer.id + ':') ||
              streamId.startsWith(peer.userId + ':')
            ) {
              targetPeer = peer;
              explicitPeerId = peer.id;
              source = track.kind === 'video' ? 'camera' : 'microphone';
              break;
            }
          }
        }
      }

      // If stream has an explicit peer ID (or streamId itself is a peer ID UUID) not yet in _remoteParticipants,
      // buffer the track so it gets attached as soon as peer_joined arrives!
      if (!targetPeer && !explicitPeerId && (streamId.length >= 32 || streamId.includes('-'))) {
        explicitPeerId = streamId;
        source = track.kind === 'video' ? 'camera' : 'microphone';
      }

      if (!targetPeer && explicitPeerId) {
        const inferredSource = source || (track.kind === 'video' ? 'camera' : 'microphone');
        const list = this.pendingRemoteTracks.get(explicitPeerId) || [];
        list.push({ track, source: inferredSource });
        this.pendingRemoteTracks.set(explicitPeerId, list);
        return;
      }

      // 3. Fallback only if no explicit hint was present and only 1 remote peer exists
      if (!targetPeer && !explicitPeerId && this._remoteParticipants.size === 1) {
        targetPeer = Array.from(this._remoteParticipants.values())[0];
      }

      // 4. Fallback: match first remote peer missing this track kind or with screen sharing
      if (!targetPeer && !explicitPeerId) {
        for (const peer of this._remoteParticipants.values()) {
          if (track.kind === 'video' && peer.screenSharing && !peer.getScreenTrack()) {
            targetPeer = peer;
            source = 'screen';
            break;
          }
          const hasKind = Array.from(peer.tracks.values()).some((t) => t.kind === track.kind);
          if (!hasKind) {
            targetPeer = peer;
            break;
          }
        }
      }

      // Determine source if not yet explicitly determined
      if (!source && targetPeer) {
        if (track.kind === 'video') {
          if (targetPeer.screenSharing && targetPeer.getVideoTrack() && !targetPeer.getScreenTrack()) {
            source = 'screen';
          } else if (targetPeer.screenSharing && !targetPeer.getVideoTrack()) {
            source = 'screen';
          } else {
            source = 'camera';
          }
        } else {
          source = 'microphone';
        }
      }

      if (targetPeer) {
        const publication = targetPeer.addTrack(track, source);
        this.emit('trackSubscribed', track, publication, targetPeer);
      }
    });

    this.webrtc.on('trackRemoved', (track: MediaStreamTrack) => {
      for (const [peerId, list] of this.pendingRemoteTracks.entries()) {
        const filtered = list.filter((item) => item.track.id !== track.id);
        if (filtered.length === 0) {
          this.pendingRemoteTracks.delete(peerId);
        } else {
          this.pendingRemoteTracks.set(peerId, filtered);
        }
      }

      for (const peer of this._remoteParticipants.values()) {
        if (peer.tracks.has(track.id)) {
          const pub = peer.tracks.get(track.id)!;
          peer.removeTrack(track.id);
          this.emit('trackUnsubscribed', track, pub, peer);
          break;
        }
      }
    });
  }

  private attachPendingTracksForPeer(peer: RemotePeer): void {
    const pending = this.pendingRemoteTracks.get(peer.id);
    if (!pending || pending.length === 0) return;
    this.pendingRemoteTracks.delete(peer.id);
    for (const item of pending) {
      if (item.track.readyState !== 'ended') {
        const publication = peer.addTrack(item.track, item.source);
        this.emit('trackSubscribed', item.track, publication, peer);
      }
    }
  }

  private setupRemotePeerListeners(peer: RemotePeer): void {
    peer.on('speakingChange', () => {
      const activeSpeakers = Array.from(this._remoteParticipants.values())
        .filter((p) => p.isSpeaking)
        .map((p) => p.id);

      if (this.localParticipant.isSpeaking) {
        activeSpeakers.unshift(this.localParticipant.id);
      }
      this.emit('activeSpeakerChanged', activeSpeakers);
    });
  }
}

