/**
 * Connected WebRTC Core SDK - Error Classes
 */

export class ConnectedError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'CONNECTED_ERROR') {
    super(message);
    this.name = 'ConnectedError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SignalingError extends ConnectedError {
  constructor(message: string, code: string = 'SIGNALING_ERROR') {
    super(message, code);
    this.name = 'SignalingError';
  }
}

export class MediaDeviceError extends ConnectedError {
  constructor(message: string, code: string = 'MEDIA_DEVICE_ERROR') {
    super(message, code);
    this.name = 'MediaDeviceError';
  }
}

export class WebRTCError extends ConnectedError {
  constructor(message: string, code: string = 'WEBRTC_ERROR') {
    super(message, code);
    this.name = 'WebRTCError';
  }
}

export class ModerationError extends ConnectedError {
  constructor(message: string, code: string = 'MODERATION_ERROR') {
    super(message, code);
    this.name = 'ModerationError';
  }
}

export class RoomError extends ConnectedError {
  constructor(message: string, code: string = 'ROOM_ERROR') {
    super(message, code);
    this.name = 'RoomError';
  }
}

export class PermissionError extends ConnectedError {
  constructor(message: string, code: string = 'PERMISSION_DENIED') {
    super(message, code);
    this.name = 'PermissionError';
  }
}

