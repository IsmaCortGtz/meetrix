import { describe, it, expect, beforeEach } from 'vitest';
import { RemotePeer } from '../src/peer';
import { ParticipantInfo } from '../src/types';
import { setupMockBrowserEnvironment, MockMediaStreamTrack } from './mocks';

describe('RemotePeer Model', () => {
  beforeEach(() => {
    setupMockBrowserEnvironment();
  });

  const baseInfo: ParticipantInfo = {
    id: 'peer-42',
    user_id: 'user-42',
    display_name: 'Carol',
    role: 'participant',
    permissions: {
      can_publish_audio: true,
      can_publish_video: true,
      can_publish_screen: true,
      can_chat: true,
      can_react: true,
    },
    is_in_lobby: false,
    audio_muted: false,
    video_muted: false,
    screen_sharing: false,
    hand_raised: false,
    joined_at: new Date().toISOString(),
  };

  it('initializes correctly from ParticipantInfo', () => {
    const peer = new RemotePeer(baseInfo);
    expect(peer.id).toBe('peer-42');
    expect(peer.userId).toBe('user-42');
    expect(peer.displayName).toBe('Carol');
    expect(peer.role).toBe('participant');
    expect(peer.audioMuted).toBe(false);
    expect(peer.videoMuted).toBe(false);
    expect(peer.screenSharing).toBe(false);
    expect(peer.handRaised).toBe(false);
  });

  it('attaches and retrieves camera and mic tracks', () => {
    const peer = new RemotePeer(baseInfo);

    const audioTrack = new MockMediaStreamTrack('audio') as unknown as MediaStreamTrack;
    const videoTrack = new MockMediaStreamTrack('video') as unknown as MediaStreamTrack;

    let subscribedCount = 0;
    peer.on('trackSubscribed', () => {
      subscribedCount++;
    });

    const audioPub = peer.addTrack(audioTrack, 'microphone');
    const videoPub = peer.addTrack(videoTrack, 'camera');

    expect(subscribedCount).toBe(2);
    expect(audioPub.source).toBe('microphone');
    expect(videoPub.source).toBe('camera');

    expect(peer.getAudioTrack()).toBe(audioTrack);
    expect(peer.getVideoTrack()).toBe(videoTrack);
    expect(peer.getScreenTrack()).toBeNull();
    expect(peer.getTracks().length).toBe(2);
  });

  it('removes tracks and emits trackUnsubscribed', () => {
    const peer = new RemotePeer(baseInfo);
    const audioTrack = new MockMediaStreamTrack('audio') as unknown as MediaStreamTrack;

    peer.addTrack(audioTrack, 'microphone');
    expect(peer.getAudioTrack()).toBe(audioTrack);

    let unsubscribedPub: any = null;
    peer.on('trackUnsubscribed', (pub) => {
      unsubscribedPub = pub;
    });

    peer.removeTrack(audioTrack.id);
    expect(peer.getAudioTrack()).toBeNull();
    expect(unsubscribedPub?.id).toBe(audioTrack.id);
  });

  it('emits state transition events when muted, screen sharing, or raising hand', () => {
    const peer = new RemotePeer(baseInfo);

    let audioMutedVal: boolean | null = null;
    let videoMutedVal: boolean | null = null;
    let screenSharingVal: boolean | null = null;
    let handRaisedVal: boolean | null = null;
    let roleVal: string | null = null;

    peer.on('audioMutedChange', (m) => (audioMutedVal = m));
    peer.on('videoMutedChange', (m) => (videoMutedVal = m));
    peer.on('screenSharingChange', (s) => (screenSharingVal = s));
    peer.on('handRaisedChange', (h) => (handRaisedVal = h));
    peer.on('roleChange', (r) => (roleVal = r));

    peer.setAudioMuted(true);
    peer.setVideoMuted(true);
    peer.setScreenSharing(true);
    peer.setHandRaised(true);
    peer.setRole('co-host');

    expect(audioMutedVal).toBe(true);
    expect(videoMutedVal).toBe(true);
    expect(screenSharingVal).toBe(true);
    expect(handRaisedVal).toBe(true);
    expect(roleVal).toBe('co-host');
  });

  it('updates state from ParticipantInfo snapshot', () => {
    const peer = new RemotePeer(baseInfo);

    peer.updateFromInfo({
      ...baseInfo,
      display_name: 'Carol (Host)',
      role: 'host',
      audio_muted: true,
      video_muted: true,
      screen_sharing: true,
      hand_raised: true,
    });

    expect(peer.displayName).toBe('Carol (Host)');
    expect(peer.role).toBe('host');
    expect(peer.audioMuted).toBe(true);
    expect(peer.videoMuted).toBe(true);
    expect(peer.screenSharing).toBe(true);
    expect(peer.handRaised).toBe(true);
  });

  it('correctly distinguishes mic audio, screen audio, camera, and screen video tracks', () => {
    const peer = new RemotePeer(baseInfo);

    const micTrack = new MockMediaStreamTrack('audio') as unknown as MediaStreamTrack;
    const screenAudioTrack = new MockMediaStreamTrack('audio') as unknown as MediaStreamTrack;
    const cameraTrack = new MockMediaStreamTrack('video') as unknown as MediaStreamTrack;
    const screenVideoTrack = new MockMediaStreamTrack('video') as unknown as MediaStreamTrack;

    peer.addTrack(micTrack, 'microphone');
    peer.addTrack(screenAudioTrack, 'screen_audio');
    peer.addTrack(cameraTrack, 'camera');
    peer.addTrack(screenVideoTrack, 'screen');

    expect(peer.getAudioTrack()).toBe(micTrack);
    expect(peer.getScreenAudioTrack()).toBe(screenAudioTrack);
    expect(peer.getVideoTrack()).toBe(cameraTrack);
    expect(peer.getScreenTrack()).toBe(screenVideoTrack);
  });
});

