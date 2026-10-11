/**
 * Meetrix WebRTC Core SDK - Test Helpers & Mocks
 */

export class MockWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  public readonly CONNECTING = 0;
  public readonly OPEN = 1;
  public readonly CLOSING = 2;
  public readonly CLOSED = 3;

  public static instances: MockWebSocket[] = [];
  public url: string;
  public readyState: number = 0; // CONNECTING
  public sentMessages: string[] = [];

  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);

    // Simulate async connection opening
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    }, 5);
  }

  public send(data: string): void {
    this.sentMessages.push(data);
  }

  public close(code: number = 1000, reason: string = ''): void {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code, reason });
  }

  public simulateServerMessage(data: unknown): void {
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage?.({ data: raw });
  }

  public simulateError(): void {
    this.onerror?.(new Error('Simulated network failure'));
  }
}

export class MockMediaStreamTrack {
  public id: string;
  public kind: 'audio' | 'video';
  public enabled: boolean = true;
  public readyState: 'live' | 'ended' = 'live';
  public onended: (() => void) | null = null;

  constructor(kind: 'audio' | 'video', id?: string) {
    this.kind = kind;
    this.id = id || `mock-${kind}-track-${Math.random().toString(36).substring(2, 9)}`;
  }

  public stop(): void {
    this.readyState = 'ended';
    this.enabled = false;
    this.onended?.();
  }
}

export class MockMediaStream {
  public id: string;
  private tracks: MockMediaStreamTrack[] = [];

  constructor(tracks: MockMediaStreamTrack[] = []) {
    this.id = `stream-${Math.random().toString(36).substring(2, 9)}`;
    this.tracks = [...tracks];
  }

  public getAudioTracks(): MockMediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio');
  }

  public getVideoTracks(): MockMediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'video');
  }

  public getTracks(): MockMediaStreamTrack[] {
    return [...this.tracks];
  }

  public addTrack(track: MockMediaStreamTrack): void {
    if (!this.tracks.includes(track)) {
      this.tracks.push(track);
    }
  }

  public removeTrack(track: MockMediaStreamTrack): void {
    const idx = this.tracks.indexOf(track);
    if (idx !== -1) {
      this.tracks.splice(idx, 1);
    }
  }
}

export class MockRTCRtpSender {
  public track: MockMediaStreamTrack | null;

  constructor(track: MockMediaStreamTrack | null) {
    this.track = track;
  }

  public async replaceTrack(newTrack: MockMediaStreamTrack | null): Promise<void> {
    this.track = newTrack;
  }
}

export class MockRTCPeerConnection {
  public static instances: MockRTCPeerConnection[] = [];
  public configuration: unknown;
  public connectionState: RTCPeerConnectionState = 'new';
  public iceConnectionState: RTCIceConnectionState = 'new';
  public iceGatheringState: RTCIceGatheringState = 'new';
  public localDescription: { type: string; sdp: string } | null = null;
  public remoteDescription: { type: string; sdp: string } | null = null;

  public onicecandidate: ((e: { candidate: any }) => void) | null = null;
  public ontrack: ((e: any) => void) | null = null;
  public onconnectionstatechange: (() => void) | null = null;
  public oniceconnectionstatechange: (() => void) | null = null;
  public onicegatheringstatechange: (() => void) | null = null;

  public transceivers: any[] = [];
  private senders: MockRTCRtpSender[] = [];

  constructor(config: unknown) {
    this.configuration = config;
    MockRTCPeerConnection.instances.push(this);
  }

  public getTransceivers(): any[] {
    return [...this.transceivers];
  }

  public addTrack(track: MockMediaStreamTrack, _stream: any): MockRTCRtpSender {
    const sender = new MockRTCRtpSender(track);
    this.senders.push(sender);
    return sender;
  }

  public removeTrack(sender: MockRTCRtpSender): void {
    const idx = this.senders.indexOf(sender);
    if (idx !== -1) {
      this.senders.splice(idx, 1);
    }
  }

  public getSenders(): MockRTCRtpSender[] {
    return [...this.senders];
  }

  public async createOffer(): Promise<{ type: 'offer'; sdp: string }> {
    return { type: 'offer', sdp: 'v=0\r\no=mock-offer' };
  }

  public async createAnswer(): Promise<{ type: 'answer'; sdp: string }> {
    return { type: 'answer', sdp: 'v=0\r\no=mock-answer' };
  }

  public async setLocalDescription(desc: { type: string; sdp: string }): Promise<void> {
    this.localDescription = desc;
  }

  public async setRemoteDescription(desc: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = desc;
  }

  public async addIceCandidate(_cand: any): Promise<void> {}

  public close(): void {
    this.connectionState = 'closed';
  }
}

export function setupMockBrowserEnvironment(): void {
  // Install Mock WebSocket
  (globalThis as any).WebSocket = MockWebSocket;
  // Install Mock WebRTC classes
  (globalThis as any).RTCPeerConnection = MockRTCPeerConnection;
  (globalThis as any).MediaStream = MockMediaStream;
  (globalThis as any).MediaStreamTrack = MockMediaStreamTrack;
}
