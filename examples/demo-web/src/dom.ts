/**
 * Connected WebRTC Demo - DOM Elements Reference
 * Centralized, typed references to document elements.
 */

// Screen Views
export const homeScreen = document.getElementById('home-screen') as HTMLElement | null;
export const previewScreen = document.getElementById('preview-screen') as HTMLElement | null;
export const lobbyScreen = document.getElementById('lobby-screen') as HTMLElement;
export const meetingScreen = document.getElementById('meeting-screen') as HTMLElement;
export const leftMeetingScreen = document.getElementById('left-meeting-screen') as HTMLElement | null;

// Context & Audio Banners
export const insecureContextBanner = document.getElementById('insecure-context-banner') as HTMLElement | null;
export const audioUnlockBanner = document.getElementById('audio-unlock-banner') as HTMLElement | null;
export const btnUnlockAudio = document.getElementById('btn-unlock-audio') as HTMLButtonElement | null;

// Home Screen Elements
export const homeClock = document.getElementById('home-clock') as HTMLElement | null;
export const btnNewMeeting = document.getElementById('btn-new-meeting') as HTMLButtonElement | null;
export const newMeetingMenu = document.getElementById('new-meeting-menu') as HTMLElement | null;
export const btnCreateForLater = document.getElementById('btn-create-for-later') as HTMLButtonElement | null;
export const btnStartInstant = document.getElementById('btn-start-instant') as HTMLButtonElement | null;
export const homeCodeInput = document.getElementById('home-code-input') as HTMLInputElement | null;
export const btnHomeJoin = document.getElementById('btn-home-join') as HTMLButtonElement | null;

// Meeting Created Modal Elements
export const meetingCreatedModal = document.getElementById('meeting-created-modal') as HTMLElement | null;
export const modalLinkInput = document.getElementById('modal-link-input') as HTMLInputElement | null;
export const btnModalCopyLink = document.getElementById('btn-modal-copy-link') as HTMLButtonElement | null;
export const modalCloseBtn = document.getElementById('modal-close-btn') as HTMLButtonElement | null;

// Greenroom / Preview Screen Elements
export const previewRoomIdText = document.getElementById('preview-room-id-text') as HTMLElement | null;
export const btnPreviewCopyLink = document.getElementById('btn-preview-copy-link') as HTMLButtonElement | null;
export const btnJoinNow = document.getElementById('btn-join-now') as HTMLButtonElement | null;
export const btnPreviewBackHome = document.getElementById('btn-preview-back-home') as HTMLButtonElement | null;
export const disableAecCheckbox = document.getElementById('disable-aec-checkbox') as HTMLInputElement | null;
export const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
export const displayNameInput = document.getElementById('display-name') as HTMLInputElement;
export const roleSelect = document.getElementById('role-select') as HTMLSelectElement;
export const authTokenInput = document.getElementById('auth-token') as HTMLInputElement;
export const previewMicSelect = document.getElementById('preview-mic-select') as HTMLSelectElement | null;
export const previewCamSelect = document.getElementById('preview-cam-select') as HTMLSelectElement | null;
export const previewVideo = document.getElementById('preview-video') as HTMLVideoElement;
export const previewAvatar = document.getElementById('preview-avatar') as HTMLElement;
export const previewMicBtn = document.getElementById('preview-mic-btn') as HTMLButtonElement;
export const previewCamBtn = document.getElementById('preview-cam-btn') as HTMLButtonElement;

// Meeting Header Elements
export const headerRoomId = document.getElementById('header-room-id') as HTMLElement;
export const btnHeaderCopyLink = document.getElementById('btn-header-copy-link') as HTMLButtonElement | null;
export const headerUserName = document.getElementById('header-user-name') as HTMLElement;
export const headerUserRole = document.getElementById('header-user-role') as HTMLElement;
export const connectionStatus = document.getElementById('connection-status') as HTMLElement;
export const sessionTimer = document.getElementById('session-timer') as HTMLElement;
export const timerText = document.getElementById('timer-text') as HTMLElement;

// Main Meeting Workspace
export const videoGrid = document.getElementById('video-grid') as HTMLElement;
export const reactionContainer = document.getElementById('reaction-container') as HTMLElement;
export const cancelLobbyBtn = document.getElementById('cancel-lobby-btn') as HTMLButtonElement;

// Sidebar & Panels
export const sidebar = document.getElementById('sidebar') as HTMLElement;
export const sidebarCloseBtn = document.getElementById('sidebar-close-btn') as HTMLButtonElement;
export const tabChatBtn = document.getElementById('tab-chat-btn') as HTMLButtonElement;
export const tabPeopleBtn = document.getElementById('tab-people-btn') as HTMLButtonElement;
export const tabControlsBtn = document.getElementById('tab-controls-btn') as HTMLButtonElement;
export const tabChat = document.getElementById('tab-chat') as HTMLElement;
export const tabPeople = document.getElementById('tab-people') as HTMLElement;
export const tabControls = document.getElementById('tab-controls') as HTMLElement;
export const chatUnreadBadge = document.getElementById('chat-unread-badge') as HTMLElement;
export const peopleCountBadge = document.getElementById('people-count') as HTMLElement;
export const chatMessages = document.getElementById('chat-messages') as HTMLElement;
export const chatForm = document.getElementById('chat-form') as HTMLFormElement;
export const chatInput = document.getElementById('chat-input') as HTMLInputElement;
export const peopleList = document.getElementById('people-list') as HTMLElement;
export const lobbyQueueSection = document.getElementById('lobby-queue-section') as HTMLElement;
export const lobbyList = document.getElementById('lobby-list') as HTMLElement;
export const lobbyCount = document.getElementById('lobby-count') as HTMLElement;

// Room Policies Switches
export const policyMic = document.getElementById('policy-mic') as HTMLInputElement;
export const policyCamera = document.getElementById('policy-camera') as HTMLInputElement;
export const policyScreen = document.getElementById('policy-screen') as HTMLInputElement;
export const policyChat = document.getElementById('policy-chat') as HTMLInputElement;
export const policyReactions = document.getElementById('policy-reactions') as HTMLInputElement;
export const policyLobby = document.getElementById('policy-lobby') as HTMLInputElement;

// Controls Bar Buttons
export const btnToggleMic = document.getElementById('btn-toggle-mic') as HTMLButtonElement;
export const btnToggleCam = document.getElementById('btn-toggle-cam') as HTMLButtonElement;
export const btnToggleScreen = document.getElementById('btn-toggle-screen') as HTMLButtonElement;
export const btnRaiseHand = document.getElementById('btn-raise-hand') as HTMLButtonElement;
export const btnReactionPicker = document.getElementById('btn-reaction-picker') as HTMLButtonElement;
export const reactionPickerMenu = document.getElementById('reaction-picker-menu') as HTMLElement;
export const btnToggleChat = document.getElementById('btn-toggle-chat') as HTMLButtonElement;
export const btnTogglePeople = document.getElementById('btn-toggle-people') as HTMLButtonElement;
export const btnLeaveCall = document.getElementById('btn-leave-call') as HTMLButtonElement;

// Post-Call Screen Buttons
export const btnRejoin = document.getElementById('btn-rejoin') as HTMLButtonElement | null;
export const btnReturnHome = document.getElementById('btn-return-home') as HTMLButtonElement | null;

// Meeting Controls Device Selectors
export const meetingMicSelect = document.getElementById('meeting-mic-select') as HTMLSelectElement | null;
export const meetingCamSelect = document.getElementById('meeting-cam-select') as HTMLSelectElement | null;
export const meetingSpeakerSelect = document.getElementById('meeting-speaker-select') as HTMLSelectElement | null;

