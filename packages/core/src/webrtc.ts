/**
 * Meetrix WebRTC Core SDK - WebRTC Manager
 * Manages RTCPeerConnection lifecycle, SDP offer/answer negotiation,
 * trickle ICE candidates, track publication, and ingress track reception.
 */

import {
  RTCIceServerConfig,
  SDPPayload,
  CandidatePayload,
} from './types';
import { SignalingClient } from './signaling';
import { WebRTCError } from './errors';
import { TypedEventEmitter } from './events';

export type WebRTCEventMap = {
  trackReceived: (track: MediaStreamTrack, stream: MediaStream, streamId?: string) => void;
  trackRemoved: (track: MediaStreamTrack) => void;
  connectionStateChange: (state: RTCPeerConnectionState) => void;
  iceConnectionStateChange: (state: RTCIceConnectionState) => void;
  iceGatheringStateChange: (state: RTCIceGatheringState) => void;
  error: (err: Error) => void;
};

export class WebRTCManager extends TypedEventEmitter<WebRTCEventMap> {
  private pc: RTCPeerConnection | null = null;
  private pendingCandidates: CandidatePayload[] = [];
  private pendingRemoteOffer: string | null = null;
  private senders: Map<string, RTCRtpSender> = new Map(); // trackId -> RTCRtpSender
  private isNegotiating: boolean = false;
  private renegotiationNeededDuringNegotiation: boolean = false;
  private closed: boolean = false;
  private trackedMediaStreams: Map<string, string> = new Map(); // trackId -> streamId
  private lastRemoteOfferSdp: string | null = null;

  constructor(private readonly signaling: SignalingClient) {
    super();
    this.setupSignalingListeners();
  }

  public get peerConnection(): RTCPeerConnection | null {
    return this.pc;
  }

  public get connectionState(): RTCPeerConnectionState {
    return this.pc?.connectionState ?? 'closed';
  }

  public get iceConnectionState(): RTCIceConnectionState {
    return this.pc?.iceConnectionState ?? 'closed';
  }

  /**
   * Initialize RTCPeerConnection with STUN/TURN ICE servers provided by the server.
   */
  public initialize(iceServers: RTCIceServerConfig[] = []): RTCPeerConnection {
    this.close();
    this.closed = false;

    const RTCPeerConnectionClass =
      typeof RTCPeerConnection !== 'undefined'
        ? RTCPeerConnection
        : (globalThis as unknown as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;

    if (!RTCPeerConnectionClass) {
      throw new WebRTCError('RTCPeerConnection is not supported in this runtime');
    }

    const rtcConfig: RTCConfiguration = {
      iceServers: iceServers.map((s) => ({
        urls: s.urls,
        username: s.username,
        credential: s.credential,
        credentialType: s.credentialType,
      })),
      bundlePolicy: 'max-bundle',
    };

    try {
      this.pc = new RTCPeerConnectionClass(rtcConfig);
    } catch (err) {
      throw new WebRTCError(
        `Failed to create RTCPeerConnection: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 1. Trickle ICE candidate event
    this.pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && this.signaling.isConnected) {
        this.signaling.sendCandidate({
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment,
        });
      }
    };

    // 2. Ingress track reception from SFU
    this.pc.ontrack = (event: RTCTrackEvent) => {
      const track = event.track;
      const stream = event.streams[0] || new MediaStream([track]);
      const receiver = event.receiver;

      // Minimize receiver playout jitter buffer for real-time interactive audio/video
      if (receiver) {
        try {
          if ('playoutDelayHint' in receiver) {
            (receiver as unknown as { playoutDelayHint: number }).playoutDelayHint = 0;
          }
          if ('jitterBufferTarget' in receiver) {
            (receiver as unknown as { jitterBufferTarget: number }).jitterBufferTarget = 0;
          }
        } catch {}
      }

      // Resolve streamId from SDP mid mapping if possible
      const mid = event.transceiver?.mid;
      let streamId: string | undefined;
      if (mid && this.lastRemoteOfferSdp) {
        const midToStream = this.parseSdpMidToStreamId(this.lastRemoteOfferSdp);
        streamId = midToStream.get(mid);
        if (streamId && stream.id !== streamId) {
          try {
            Object.defineProperty(stream, 'id', {
              value: streamId,
              configurable: true,
              writable: false,
            });
          } catch {}
        }
      }

      this.handleTrackReceived(track, stream, streamId);
    };

    // 3. State change listeners
    this.pc.onconnectionstatechange = () => {
      if (this.pc) {
        this.emit('connectionStateChange', this.pc.connectionState);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (this.pc) {
        this.emit('iceConnectionStateChange', this.pc.iceConnectionState);
      }
    };

    this.pc.onicegatheringstatechange = () => {
      if (this.pc) {
        this.emit('iceGatheringStateChange', this.pc.iceGatheringState);
      }
    };

    if (this.pendingRemoteOffer) {
      const pending = this.pendingRemoteOffer;
      this.pendingRemoteOffer = null;
      void this.handleRemoteOffer(pending);
    }

    return this.pc;
  }

  private setupSignalingListeners(): void {
    // Handling remote offer from SFU (renegotiation initiated by server)
    this.signaling.on('offer', async (payload: SDPPayload) => {
      try {
        await this.handleRemoteOffer(payload.sdp);
      } catch (err) {
        const error = new WebRTCError(
          `Failed to process remote offer: ${err instanceof Error ? err.message : String(err)}`
        );
        this.emit('error', error);
      }
    });

    // Handling remote answer from SFU (response to client offer)
    this.signaling.on('answer', async (payload: SDPPayload) => {
      try {
        await this.handleRemoteAnswer(payload.sdp);
      } catch (err) {
        const error = new WebRTCError(
          `Failed to process remote answer: ${err instanceof Error ? err.message : String(err)}`
        );
        this.emit('error', error);
      }
    });

    // Handling remote trickle ICE candidate from SFU
    this.signaling.on('candidate', async (payload: CandidatePayload) => {
      try {
        await this.handleRemoteCandidate(payload);
      } catch (err) {
        // Candidate errors are usually benign during transitions
        console.warn('Failed to add remote ICE candidate:', err);
      }
    });
  }

  /**
   * Handle an SDP Offer received from the SFU server.
   */
  public async handleRemoteOffer(sdp: string): Promise<void> {
    if (!this.pc) {
      this.pendingRemoteOffer = sdp;
      return;
    }

    // SDP Glare & Perfect Negotiation Rollback: polite peer rolls back on glare
    if (this.isNegotiating || this.pc.signalingState !== 'stable') {
      await this.pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit).catch(() => {});
      this.isNegotiating = false;
      this.renegotiationNeededDuringNegotiation = true;
    }

    const RTCSessionDescriptionClass =
      typeof RTCSessionDescription !== 'undefined'
        ? RTCSessionDescription
        : (globalThis as unknown as { RTCSessionDescription?: typeof RTCSessionDescription }).RTCSessionDescription;

    const desc = RTCSessionDescriptionClass
      ? new RTCSessionDescriptionClass({ type: 'offer', sdp })
      : ({ type: 'offer', sdp } as RTCSessionDescriptionInit);

    this.lastRemoteOfferSdp = sdp;
    await this.pc.setRemoteDescription(desc);
    await this.drainPendingCandidates();

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    // Reconcile transceiver tracks AFTER local answer is set so that
    // transceiver.currentDirection has settled to the newly negotiated direction!
    this.reconcileTransceiverTracks(sdp);

    this.signaling.sendAnswer({
      sdp: answer.sdp || '',
      type: 'answer',
    });

    if (this.renegotiationNeededDuringNegotiation) {
      this.renegotiationNeededDuringNegotiation = false;
      await this.negotiate();
    }
  }

  /**
   * Handle an SDP Answer received from the SFU server.
   */
  public async handleRemoteAnswer(sdp: string): Promise<void> {
    if (!this.pc) {
      throw new WebRTCError('PeerConnection not initialized when receiving answer');
    }

    const RTCSessionDescriptionClass =
      typeof RTCSessionDescription !== 'undefined'
        ? RTCSessionDescription
        : (globalThis as unknown as { RTCSessionDescription?: typeof RTCSessionDescription }).RTCSessionDescription;

    const desc = RTCSessionDescriptionClass
      ? new RTCSessionDescriptionClass({ type: 'answer', sdp })
      : ({ type: 'answer', sdp } as RTCSessionDescriptionInit);

    await this.pc.setRemoteDescription(desc);
    await this.drainPendingCandidates();

    this.isNegotiating = false;

    if (this.renegotiationNeededDuringNegotiation) {
      this.renegotiationNeededDuringNegotiation = false;
      await this.negotiate();
    }
  }

  /**
   * Add a remote ICE candidate, buffering if remote description isn't set yet.
   */
  public async handleRemoteCandidate(candidate: CandidatePayload): Promise<void> {
    if (!candidate || !candidate.candidate) {
      return;
    }

    if (!this.pc || !this.pc.remoteDescription || !this.pc.remoteDescription.type) {
      this.pendingCandidates.push(candidate);
      return;
    }

    const RTCIceCandidateClass =
      typeof RTCIceCandidate !== 'undefined'
        ? RTCIceCandidate
        : (globalThis as unknown as { RTCIceCandidate?: typeof RTCIceCandidate }).RTCIceCandidate;

    const candInit: RTCIceCandidateInit = {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment,
    };

    const iceCandidate = RTCIceCandidateClass
      ? new RTCIceCandidateClass(candInit)
      : (candInit as RTCIceCandidate);

    await this.pc.addIceCandidate(iceCandidate);
  }

  private async drainPendingCandidates(): Promise<void> {
    if (!this.pc || this.pendingCandidates.length === 0) {
      return;
    }

    const candidates = [...this.pendingCandidates];
    this.pendingCandidates = [];

    const RTCIceCandidateClass =
      typeof RTCIceCandidate !== 'undefined'
        ? RTCIceCandidate
        : (globalThis as unknown as { RTCIceCandidate?: typeof RTCIceCandidate }).RTCIceCandidate;

    for (const cand of candidates) {
      try {
        const candInit: RTCIceCandidateInit = {
          candidate: cand.candidate,
          sdpMid: cand.sdpMid,
          sdpMLineIndex: cand.sdpMLineIndex,
          usernameFragment: cand.usernameFragment,
        };
        const iceCandidate = RTCIceCandidateClass
          ? new RTCIceCandidateClass(candInit)
          : (candInit as RTCIceCandidate);

        await this.pc.addIceCandidate(iceCandidate);
      } catch (err) {
        console.warn('Failed to drain pending candidate:', err);
      }
    }
  }

  /**
   * Perform client-initiated SDP offer negotiation with the server.
   */
  public async negotiate(): Promise<void> {
    if (!this.pc || this.closed) {
      return;
    }

    if (this.isNegotiating || this.pc.signalingState !== 'stable') {
      this.renegotiationNeededDuringNegotiation = true;
      return;
    }

    this.isNegotiating = true;

    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      this.signaling.sendOffer({
        sdp: offer.sdp || '',
        type: 'offer',
      });
    } catch (err) {
      this.isNegotiating = false;
      throw new WebRTCError(
        `Failed to negotiate offer: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Publish a local media track to the SFU.
   */
  public async publishTrack(
    track: MediaStreamTrack,
    stream: MediaStream
  ): Promise<RTCRtpSender> {
    if (!this.pc) {
      throw new WebRTCError('Cannot publish track: RTCPeerConnection not initialized');
    }

    // Check if track is already published
    const existingSender = this.senders.get(track.id);
    if (existingSender) {
      return existingSender;
    }

    const sender = this.pc.addTrack(track, stream);
    this.senders.set(track.id, sender);

    await this.negotiate();
    return sender;
  }

  /**
   * Unpublish a local media track.
   */
  public async unpublishTrack(trackOrId: MediaStreamTrack | string): Promise<void> {
    if (!this.pc) {
      return;
    }

    const trackId = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
    const sender = this.senders.get(trackId);
    if (!sender) {
      return;
    }

    this.senders.delete(trackId);
    this.pc.removeTrack(sender);

    await this.negotiate();
  }

  /**
   * Seamlessly replace an existing sender's track without SDP renegotiation.
   */
  public async replaceTrack(
    oldTrackId: string,
    newTrack: MediaStreamTrack | null
  ): Promise<void> {
    const sender = this.senders.get(oldTrackId);
    if (!sender) {
      throw new WebRTCError(`No RTCRtpSender found for track ID ${oldTrackId}`);
    }

    await sender.replaceTrack(newTrack);

    if (newTrack) {
      this.senders.delete(oldTrackId);
      this.senders.set(newTrack.id, sender);
    }
  }

  /**
   * Find sender for a given track kind.
   */
  public getSenderForKind(kind: 'audio' | 'video'): RTCRtpSender | undefined {
    if (!this.pc) return undefined;
    return this.pc.getSenders().find((s) => s.track?.kind === kind);
  }

  /**
   * Parse SDP to extract mid -> streamId and mid -> direction mappings.
   */
  public parseSdpMediaSections(sdp: string): {
    midToStream: Map<string, string>;
    midToDirection: Map<string, string>;
  } {
    const midToStream = new Map<string, string>();
    const midToDirection = new Map<string, string>();
    if (!sdp) return { midToStream, midToDirection };

    const lines = sdp.split(/\r?\n/);
    let currentMid: string | null = null;
    let currentStreamId: string | null = null;
    let currentDirection: string | null = null;

    const saveCurrent = () => {
      if (currentMid) {
        if (currentStreamId) {
          midToStream.set(currentMid, currentStreamId);
        }
        if (currentDirection) {
          midToDirection.set(currentMid, currentDirection);
        }
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('m=')) {
        saveCurrent();
        currentMid = null;
        currentStreamId = null;
        currentDirection = null;
      } else if (trimmed.startsWith('a=mid:')) {
        currentMid = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('a=msid:')) {
        const parts = trimmed.slice(7).trim().split(/\s+/);
        if (parts.length > 0 && parts[0] && parts[0] !== '-') {
          currentStreamId = parts[0];
        }
      } else if (
        trimmed === 'a=sendrecv' ||
        trimmed === 'a=sendonly' ||
        trimmed === 'a=recvonly' ||
        trimmed === 'a=inactive'
      ) {
        currentDirection = trimmed.slice(2);
      }
    }
    saveCurrent();

    return { midToStream, midToDirection };
  }

  /**
   * Parse SDP to extract mid -> streamId mapping from `a=mid:<mid>` and `a=msid:<streamId> <trackId>`.
   */
  public parseSdpMidToStreamId(sdp: string): Map<string, string> {
    return this.parseSdpMediaSections(sdp).midToStream;
  }

  /**
   * Reconcile transceiver tracks after SDP negotiation.
   * W3C WebRTC specification: pc.ontrack only fires once per transceiver when first associated.
   * When transceivers are reused or unmuted during renegotiation, pc.ontrack does not fire again.
   * This method detects receiving transceivers and ensures trackReceived/trackRemoved are dispatched.
   */
  public reconcileTransceiverTracks(sdp?: string): void {
    if (!this.pc || typeof this.pc.getTransceivers !== 'function') {
      return;
    }

    const offerSdp = sdp || this.lastRemoteOfferSdp || '';
    const { midToStream, midToDirection } = this.parseSdpMediaSections(offerSdp);
    const transceivers = this.pc.getTransceivers();
    const activeTrackIds = new Set<string>();

    for (const transceiver of transceivers) {
      const mid = transceiver.mid;
      const sdpDirection = mid ? midToDirection.get(mid) : undefined;
      const isSdpInactive = sdpDirection === 'inactive';
      const isSdpSending = sdpDirection === 'sendonly' || sdpDirection === 'sendrecv';

      // A transceiver is actively receiving if:
      // 1. It is not inactive in the offer, AND
      // 2. Either currentDirection indicates receiving, OR the offer SDP indicates sending and transceiver direction allows receiving.
      const isReceiving = !isSdpInactive && (
        transceiver.currentDirection === 'recvonly' ||
        transceiver.currentDirection === 'sendrecv' ||
        (isSdpSending && (transceiver.direction === 'recvonly' || transceiver.direction === 'sendrecv'))
      );

      const receiver = transceiver.receiver;
      const track = receiver?.track;

      // Minimize receiver playout jitter buffer for real-time interactive audio/video
      if (receiver) {
        try {
          if ('playoutDelayHint' in receiver) {
            (receiver as unknown as { playoutDelayHint: number }).playoutDelayHint = 0;
          }
          if ('jitterBufferTarget' in receiver) {
            (receiver as unknown as { jitterBufferTarget: number }).jitterBufferTarget = 0;
          }
        } catch {}
      }

      if (isReceiving && track && track.readyState !== 'ended') {
        activeTrackIds.add(track.id);

        const streamIdFromSdp = mid ? midToStream.get(mid) : undefined;
        const receiverStreams = (receiver as unknown as { streams?: MediaStream[] }).streams;
        const streamId = streamIdFromSdp || receiverStreams?.[0]?.id || 'default';

        const stream = receiverStreams?.[0] || new MediaStream([track]);
        if (stream.id !== streamId) {
          try {
            Object.defineProperty(stream, 'id', {
              value: streamId,
              configurable: true,
              writable: false,
            });
          } catch {}
        }

        this.handleTrackReceived(track, stream, streamId);
      } else if (track && this.trackedMediaStreams.has(track.id)) {
        this.handleTrackRemoved(track);
      }
    }

    // Clean up any tracked tracks that are no longer present in any receiving transceiver
    for (const [trackId] of Array.from(this.trackedMediaStreams.entries())) {
      if (!activeTrackIds.has(trackId)) {
        const transceiver = transceivers.find((t) => t.receiver?.track?.id === trackId);
        if (transceiver?.receiver?.track) {
          this.handleTrackRemoved(transceiver.receiver.track);
        } else {
          this.trackedMediaStreams.delete(trackId);
        }
      }
    }
  }

  private handleTrackReceived(track: MediaStreamTrack, stream: MediaStream, explicitStreamId?: string): void {
    const streamId = explicitStreamId || stream.id;
    const previousStreamId = this.trackedMediaStreams.get(track.id);
    if (previousStreamId === streamId) {
      // Already tracked with the same stream ID, avoid duplicate dispatch
      return;
    }

    if (previousStreamId && previousStreamId !== streamId) {
      // Transceiver track reassigned to another stream/peer
      this.emit('trackRemoved', track);
    }

    this.trackedMediaStreams.set(track.id, streamId);

    track.onended = () => {
      this.handleTrackRemoved(track);
    };

    this.emit('trackReceived', track, stream, streamId);
  }

  private handleTrackRemoved(track: MediaStreamTrack): void {
    if (this.trackedMediaStreams.has(track.id)) {
      this.trackedMediaStreams.delete(track.id);
      this.emit('trackRemoved', track);
    }
  }

  /**
   * Clean up PeerConnection and all associated tracks/listeners.
   */
  public close(): void {
    this.closed = true;
    this.pendingCandidates = [];
    this.pendingRemoteOffer = null;
    this.senders.clear();
    this.isNegotiating = false;
    this.renegotiationNeededDuringNegotiation = false;
    this.trackedMediaStreams.clear();
    this.lastRemoteOfferSdp = null;

    if (this.pc) {
      try {
        this.pc.onicecandidate = null;
        this.pc.ontrack = null;
        this.pc.onconnectionstatechange = null;
        this.pc.oniceconnectionstatechange = null;
        this.pc.onicegatheringstatechange = null;
        this.pc.close();
      } catch {}
        this.pc = null;
    }
  }
}
