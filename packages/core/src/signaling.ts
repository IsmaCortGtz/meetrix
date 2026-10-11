/**
 * Connected WebRTC Core SDK - Signaling Client
 * Manages WebSocket connection, message serialization/deserialization,
 * event dispatching, and resilient auto-reconnect with exponential backoff.
 */

import {
  SignalingEnvelope,
  JoinPayload,
  SDPPayload,
  CandidatePayload,
  ChatMessagePayload,
  ReactionPayload,
  RaiseHandPayload,
  AdmitPeerPayload,
  MutePeerPayload,
  StopPeerMediaPayload,
  KickPeerPayload,
  UpdatePoliciesPayload,
  JoinedPayload,
  PeerJoinedPayload,
  PeerLeftPayload,
  ChatBroadcastPayload,
  ReactionBroadcastPayload,
  HandRaisedBroadcastPayload,
  PolicyUpdatedPayload,
  PeerMutedPayload,
  PeerMediaStoppedPayload,
  KickedPayload,
  LobbyWaitingPayload,
  LobbyPeerWaitingPayload,
  SessionTimerTickPayload,
  SessionEndedPayload,
  ErrorPayload,
  MediaStateChangedPayload,
} from './types';
import { TypedEventEmitter } from './events';
import { SignalingError } from './errors';

export interface SignalingClientOptions {
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectBaseDelay?: number;
  reconnectMaxDelay?: number;
  reconnectBackoffFactor?: number;
}

export type SignalingEventMap = {
  open: () => void;
  close: (info: { code: number; reason: string }) => void;
  reconnecting: (attempt: number, delayMs: number) => void;
  reconnected: () => void;
  error: (err: Error) => void;

  // Server message dispatches
  joined: (payload: JoinedPayload) => void;
  peer_joined: (payload: PeerJoinedPayload) => void;
  peer_left: (payload: PeerLeftPayload) => void;
  offer: (payload: SDPPayload) => void;
  answer: (payload: SDPPayload) => void;
  candidate: (payload: CandidatePayload) => void;
  chat_message: (payload: ChatBroadcastPayload) => void;
  reaction: (payload: ReactionBroadcastPayload) => void;
  hand_raised: (payload: HandRaisedBroadcastPayload) => void;
  policy_updated: (payload: PolicyUpdatedPayload) => void;
  peer_muted: (payload: PeerMutedPayload) => void;
  peer_media_stopped: (payload: PeerMediaStoppedPayload) => void;
  kicked: (payload: KickedPayload) => void;
  lobby_waiting: (payload: LobbyWaitingPayload) => void;
  lobby_peer_waiting: (payload: LobbyPeerWaitingPayload) => void;
  session_timer_tick: (payload: SessionTimerTickPayload) => void;
  session_ended: (payload: SessionEndedPayload) => void;
  media_state_changed: (payload: MediaStateChangedPayload) => void;
  server_error: (payload: ErrorPayload) => void;
};

export class SignalingClient extends TypedEventEmitter<SignalingEventMap> {
  private ws: WebSocket | null = null;
  private url: string = '';
  private intentionalClose: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: string[] = [];

  private readonly autoReconnect: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseDelay: number;
  private readonly reconnectMaxDelay: number;
  private readonly reconnectBackoffFactor: number;

  constructor(options: SignalingClientOptions = {}) {
    super();
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectBaseDelay = options.reconnectBaseDelay ?? 1000;
    this.reconnectMaxDelay = options.reconnectMaxDelay ?? 10000;
    this.reconnectBackoffFactor = options.reconnectBackoffFactor ?? 1.5;
  }

  public get isConnected(): boolean {
    const openState =
      typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number'
        ? WebSocket.OPEN
        : 1;
    return this.ws !== null && this.ws.readyState === openState;
  }

  public get isConnecting(): boolean {
    const connectingState =
      typeof WebSocket !== 'undefined' && typeof WebSocket.CONNECTING === 'number'
        ? WebSocket.CONNECTING
        : 0;
    return this.ws !== null && this.ws.readyState === connectingState;
  }

  /**
   * Connect to the signaling server WebSocket endpoint.
   */
  public connect(url: string): Promise<void> {
    this.url = url;
    this.intentionalClose = false;

    return new Promise((resolve, reject) => {
      let resolved = false;

      const WebSocketClass =
        typeof WebSocket !== 'undefined'
          ? WebSocket
          : (globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket;

      if (!WebSocketClass) {
        const err = new SignalingError('WebSocket is not supported in this runtime');
        this.emit('error', err);
        reject(err);
        return;
      }

      try {
        this.ws = new WebSocketClass(url);
      } catch (err) {
        const error = new SignalingError(
          `WebSocket initialization failed: ${err instanceof Error ? err.message : String(err)}`
        );
        this.emit('error', error);
        reject(error);
        return;
      }

      this.ws.onopen = () => {
        resolved = true;
        const wasReconnecting = this.reconnectAttempts > 0;
        this.reconnectAttempts = 0;

        // Flush queued messages
        this.flushQueue();

        this.emit('open');
        if (wasReconnecting) {
          this.emit('reconnected');
        }
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (event: Event) => {
        const err = new SignalingError('WebSocket transport error occurred');
        this.emit('error', err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      };

      this.ws.onclose = (event: CloseEvent) => {
        const code = event.code;
        const reason = event.reason || '';

        this.emit('close', { code, reason });

        if (!this.intentionalClose && this.autoReconnect) {
          this.scheduleReconnect();
        }

        if (!resolved) {
          resolved = true;
          reject(new SignalingError(`WebSocket closed before connecting (code: ${code}, reason: ${reason})`));
        }
      };
    });
  }

  /**
   * Disconnect the signaling connection cleanly.
   */
  public disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close(1000, 'Normal closure');
      } catch {}
      this.ws = null;
    }
    this.messageQueue = [];
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('error', new SignalingError('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const expDelay = this.reconnectBaseDelay * Math.pow(this.reconnectBackoffFactor, this.reconnectAttempts - 1);
    const jitter = Math.random() * 500;
    const delay = Math.min(this.reconnectMaxDelay, expDelay + jitter);

    this.emit('reconnecting', this.reconnectAttempts, delay);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalClose) {
        this.connect(this.url).catch(() => {
          // Failure will trigger onclose which schedules next reconnect
        });
      }
    }, delay);
  }

  private handleMessage(data: string | ArrayBuffer | Blob): void {
    if (typeof data !== 'string') {
      return;
    }

    try {
      const envelope: SignalingEnvelope = JSON.parse(data);
      if (!envelope || !envelope.type) {
        return;
      }

      switch (envelope.type) {
        case 'joined':
          this.emit('joined', envelope.payload as JoinedPayload);
          break;
        case 'peer_joined':
          this.emit('peer_joined', envelope.payload as PeerJoinedPayload);
          break;
        case 'peer_left':
          this.emit('peer_left', envelope.payload as PeerLeftPayload);
          break;
        case 'offer':
          this.emit('offer', envelope.payload as SDPPayload);
          break;
        case 'answer':
          this.emit('answer', envelope.payload as SDPPayload);
          break;
        case 'candidate':
          this.emit('candidate', envelope.payload as CandidatePayload);
          break;
        case 'chat_message':
          this.emit('chat_message', envelope.payload as ChatBroadcastPayload);
          break;
        case 'reaction':
          this.emit('reaction', envelope.payload as ReactionBroadcastPayload);
          break;
        case 'hand_raised':
          this.emit('hand_raised', envelope.payload as HandRaisedBroadcastPayload);
          break;
        case 'policy_updated':
          this.emit('policy_updated', envelope.payload as PolicyUpdatedPayload);
          break;
        case 'peer_muted':
          this.emit('peer_muted', envelope.payload as PeerMutedPayload);
          break;
        case 'peer_media_stopped':
          this.emit('peer_media_stopped', envelope.payload as PeerMediaStoppedPayload);
          break;
        case 'media_state_changed':
          this.emit('media_state_changed', envelope.payload as MediaStateChangedPayload);
          break;
        case 'kicked':
          this.emit('kicked', envelope.payload as KickedPayload);
          break;
        case 'lobby_waiting':
          this.emit('lobby_waiting', envelope.payload as LobbyWaitingPayload);
          break;
        case 'lobby_peer_waiting':
          this.emit('lobby_peer_waiting', envelope.payload as LobbyPeerWaitingPayload);
          break;
        case 'session_timer_tick':
          this.emit('session_timer_tick', envelope.payload as SessionTimerTickPayload);
          break;
        case 'session_ended':
          this.emit('session_ended', envelope.payload as SessionEndedPayload);
          break;
        case 'error':
          this.emit('server_error', envelope.payload as ErrorPayload);
          break;
        default:
          console.warn(`[SignalingClient] Unhandled message type: ${envelope.type}`);
      }
    } catch (err) {
      console.warn('[SignalingClient] Failed to parse signaling message JSON:', err);
    }
  }

  /**
   * Send a generic type-safe signaling envelope to the server.
   */
  public send<T>(type: string, payload?: T): void {
    const envelope: SignalingEnvelope<T> = {
      type,
      payload,
    };
    const message = JSON.stringify(envelope);

    if (this.isConnected) {
      this.ws!.send(message);
    } else {
      // Queue until connected
      this.messageQueue.push(message);
    }
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected) {
      const msg = this.messageQueue.shift();
      if (msg) {
        this.ws!.send(msg);
      }
    }
  }

  // ==========================================
  // Typed Message Senders
  // ==========================================

  public sendJoin(payload: JoinPayload): void {
    this.send('join', payload);
  }

  public sendOffer(payload: SDPPayload): void {
    this.send('offer', payload);
  }

  public sendAnswer(payload: SDPPayload): void {
    this.send('answer', payload);
  }

  public sendCandidate(payload: CandidatePayload): void {
    this.send('candidate', payload);
  }

  public sendChatMessage(payload: ChatMessagePayload): void {
    this.send('chat_message', payload);
  }

  public sendReaction(payload: ReactionPayload): void {
    this.send('reaction', payload);
  }

  public sendRaiseHand(payload: RaiseHandPayload): void {
    this.send('raise_hand', payload);
  }

  public sendAdmitPeer(payload: AdmitPeerPayload): void {
    this.send('admit_peer', payload);
  }

  public sendMutePeer(payload: MutePeerPayload): void {
    this.send('mute_peer', payload);
  }

  public sendStopPeerMedia(payload: StopPeerMediaPayload): void {
    this.send('stop_peer_media', payload);
  }

  public sendKickPeer(payload: KickPeerPayload): void {
    this.send('kick_peer', payload);
  }

  public sendUpdatePolicies(payload: UpdatePoliciesPayload): void {
    this.send('update_policies', payload);
  }

  public sendMediaStateChanged(payload: Partial<MediaStateChangedPayload>): void {
    this.send('media_state_changed', payload);
  }

  public sendLeave(): void {
    this.send('leave', {});
  }
}
