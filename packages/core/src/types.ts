/**
 * Connected WebRTC Core SDK - Type Definitions
 * Complete TypeScript interfaces matching the Go SFU signaling protocol and browser media models.
 */

// ==========================================
// Roles & Permissions
// ==========================================

export type Role = 'host' | 'co-host' | 'participant' | 'viewer';

export type ModerationAction =
  | 'mute'
  | 'stop_media'
  | 'kick'
  | 'admit'
  | 'update_policy'
  | 'end_room';

export type MediaKind = 'audio' | 'video' | 'screen';

export interface RoomPolicy {
  allow_camera: boolean;
  allow_mic: boolean;
  allow_screen_share: boolean;
  allow_chat: boolean;
  allow_reactions: boolean;
  require_lobby: boolean;
}

export interface UserPermissions {
  can_publish_audio: boolean;
  can_publish_video: boolean;
  can_publish_screen: boolean;
  can_chat: boolean;
  can_react: boolean;
}

export interface ParticipantInfo {
  id: string;
  user_id: string;
  display_name: string;
  role: Role;
  permissions: UserPermissions;
  is_in_lobby: boolean;
  audio_muted: boolean;
  video_muted: boolean;
  screen_sharing: boolean;
  hand_raised: boolean;
  joined_at: string;
}

// ==========================================
// WebRTC & ICE
// ==========================================

export interface RTCIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: 'password' | 'oauth';
}

// ==========================================
// Signaling Envelope & Payloads
// ==========================================

export interface SignalingEnvelope<T = unknown> {
  type: string;
  payload?: T;
}

// Inbound Payloads (Client -> Server)

export interface JoinPayload {
  room_id: string;
  token?: string;
  user_id?: string;
  display_name?: string;
  metadata?: Record<string, unknown>;
}

export interface SDPPayload {
  sdp: string;
  type: 'offer' | 'answer';
}

export interface CandidatePayload {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface ChatMessagePayload {
  text: string;
}

export interface ReactionPayload {
  emoji: string;
}

export interface RaiseHandPayload {
  raised: boolean;
}

export interface AdmitPeerPayload {
  peer_id: string;
}

export interface MutePeerPayload {
  peer_id: string;
  media: 'audio' | 'video';
}

export interface StopPeerMediaPayload {
  peer_id: string;
  media: 'screenshare' | 'audio' | 'video';
}

export interface KickPeerPayload {
  peer_id: string;
  reason?: string;
}

export interface UpdatePoliciesPayload {
  policies: RoomPolicy;
}

// Outbound Payloads (Server -> Client)

export interface JoinedPayload {
  peer_id: string;
  user_id: string;
  display_name: string;
  role: Role;
  permissions: UserPermissions;
  policies?: RoomPolicy;
  room_policies?: RoomPolicy;
  participants: ParticipantInfo[];
  session_remaining_sec: number;
  ice_servers: RTCIceServerConfig[];
}

export interface PeerJoinedPayload {
  peer: ParticipantInfo;
}

export interface PeerLeftPayload {
  peer_id: string;
}

export interface ChatBroadcastPayload {
  id: string;
  peer_id: string;
  user_id: string;
  display_name: string;
  text: string;
  timestamp: string;
}

export interface ReactionBroadcastPayload {
  peer_id: string;
  user_id: string;
  emoji: string;
  timestamp: string;
}

export interface HandRaisedBroadcastPayload {
  peer_id: string;
  raised: boolean;
}

export interface PolicyUpdatedPayload {
  policies: RoomPolicy;
}

export interface PeerMutedPayload {
  peer_id: string;
  media: 'audio' | 'video';
  by_peer_id: string;
}

export interface PeerMediaStoppedPayload {
  peer_id: string;
  media: string;
  by_peer_id: string;
}

export interface KickedPayload {
  reason?: string;
  by_peer_id: string;
}

export interface LobbyWaitingPayload {
  message: string;
}

export interface LobbyPeerWaitingPayload {
  peer: ParticipantInfo;
}

export interface SessionTimerTickPayload {
  remaining_sec: number;
}

export interface SessionEndedPayload {
  reason: string;
}

export interface MediaStateChangedPayload {
  peer_id: string;
  audio_muted?: boolean;
  video_muted?: boolean;
  screen_sharing?: boolean;
  screen_track_id?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

// ==========================================
// Local Media & Publications
// ==========================================

export type TrackSource = 'camera' | 'microphone' | 'screen' | 'screen_audio' | 'custom';

export interface TrackPublication {
  id: string;
  kind: 'audio' | 'video';
  source: TrackSource;
  track: MediaStreamTrack;
  stream: MediaStream;
  isMuted: boolean;
}

export type VideoResolutionPreset = '360p' | '480p' | '720p' | '1080p' | '4k';

export interface CameraOptions {
  deviceId?: string;
  resolution?: VideoResolutionPreset | MediaTrackConstraints;
  facingMode?: 'user' | 'environment';
  frameRate?: number;
}

export interface MicrophoneOptions {
  deviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
}

export interface ScreenShareOptions {
  audio?: boolean;
  video?: boolean | MediaTrackConstraints;
  cursor?: 'always' | 'motion' | 'never';
  displaySurface?: 'browser' | 'monitor' | 'window';
}

export interface MediaDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
  groupId: string;
}

export interface AudioActivityConfig {
  threshold?: number; // Volume threshold for speaking detection (0.0 to 1.0, default: 0.05)
  intervalMs?: number; // Analysis poll interval in ms (default: 50)
  smoothingTimeConstant?: number; // AnalyserNode smoothing constant (default: 0.8)
  speakingHoldMs?: number; // How long to stay in speaking state before emitting stopped (default: 300)
}

// ==========================================
// Room Options & State
// ==========================================

export interface MediaJoinOptions {
  camera?: boolean | CameraOptions;
  microphone?: boolean | MicrophoneOptions;
}

export interface JoinOptions {
  url: string;
  token?: string;
  displayName?: string;
  userId?: string;
  roomId?: string;
  metadata?: Record<string, unknown>;
  mediaOptions?: MediaJoinOptions;
}

export type RoomConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'lobby'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface ModerationActionEvent {
  action: ModerationAction;
  targetPeerId?: string;
  byPeerId?: string;
  reason?: string;
  media?: string;
}

