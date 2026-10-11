/**
 * Meetrix WebRTC Core SDK - Error Classes
 */

export class MeetrixError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'MEETRIX_ERROR') {
    super(message);
    this.name = 'MeetrixError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}


export class SignalingError extends MeetrixError {
  constructor(message: string, code: string = 'SIGNALING_ERROR') {
    super(message, code);
    this.name = 'SignalingError';
  }
}

export class MediaDeviceError extends MeetrixError {
  constructor(message: string, code: string = 'MEDIA_DEVICE_ERROR') {
    super(message, code);
    this.name = 'MediaDeviceError';
  }
}

export class WebRTCError extends MeetrixError {
  constructor(message: string, code: string = 'WEBRTC_ERROR') {
    super(message, code);
    this.name = 'WebRTCError';
  }
}

export class ModerationError extends MeetrixError {
  constructor(message: string, code: string = 'MODERATION_ERROR') {
    super(message, code);
    this.name = 'ModerationError';
  }
}

export class RoomError extends MeetrixError {
  constructor(message: string, code: string = 'ROOM_ERROR') {
    super(message, code);
    this.name = 'RoomError';
  }
}

export class PermissionError extends MeetrixError {
  constructor(message: string, code: string = 'PERMISSION_DENIED') {
    super(message, code);
    this.name = 'PermissionError';
  }
}
