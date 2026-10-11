package permissions

// Role represents the participant's permission tier within a room.
type Role string

const (
	RoleHost        Role = "host"
	RoleCoHost      Role = "co-host"
	RoleParticipant Role = "participant"
	RoleViewer      Role = "viewer"
)

// ModerationAction represents a Google Meet-style administrative action.
type ModerationAction string

const (
	ActionMute         ModerationAction = "mute"
	ActionStopMedia    ModerationAction = "stop_media"
	ActionKick         ModerationAction = "kick"
	ActionAdmit        ModerationAction = "admit"
	ActionUpdatePolicy ModerationAction = "update_policy"
	ActionEndRoom      ModerationAction = "end_room"
)

// MediaKind identifies the type of media stream.
type MediaKind string

const (
	MediaKindAudio  MediaKind = "audio"
	MediaKindVideo  MediaKind = "video"
	MediaKindScreen MediaKind = "screen"
)

// RoomPolicy defines the room-wide restrictions and features configured by hosts.
type RoomPolicy struct {
	AllowCamera      bool `json:"allow_camera"`
	AllowMic         bool `json:"allow_mic"`
	AllowScreenShare bool `json:"allow_screen_share"`
	AllowChat        bool `json:"allow_chat"`
	AllowReactions   bool `json:"allow_reactions"`
	RequireLobby     bool `json:"require_lobby"`
}

// UserPermissions defines individual participant capabilities overrides.
type UserPermissions struct {
	CanPublishAudio  bool `json:"can_publish_audio"`
	CanPublishVideo  bool `json:"can_publish_video"`
	CanPublishScreen bool `json:"can_publish_screen"`
	CanChat          bool `json:"can_chat"`
	CanReact         bool `json:"can_react"`
}

// DefaultPermissionsForRole returns default permissions corresponding to a given role.
func DefaultPermissionsForRole(role Role) UserPermissions {
	switch role {
	case RoleHost, RoleCoHost:
		return UserPermissions{
			CanPublishAudio:  true,
			CanPublishVideo:  true,
			CanPublishScreen: true,
			CanChat:          true,
			CanReact:         true,
		}
	case RoleParticipant:
		return UserPermissions{
			CanPublishAudio:  true,
			CanPublishVideo:  true,
			CanPublishScreen: true,
			CanChat:          true,
			CanReact:         true,
		}
	case RoleViewer:
		return UserPermissions{
			CanPublishAudio:  false,
			CanPublishVideo:  false,
			CanPublishScreen: false,
			CanChat:          true,
			CanReact:         true,
		}
	default:
		return UserPermissions{}
	}
}

// RoleLevel returns numeric hierarchy for role comparison.
func RoleLevel(role Role) int {
	switch role {
	case RoleHost:
		return 3
	case RoleCoHost:
		return 2
	case RoleParticipant:
		return 1
	case RoleViewer:
		return 0
	default:
		return -1
	}
}

// CanPublishMedia checks if a participant is allowed to publish the specified media track.
// Hosts and Co-Hosts bypass room-level media locks. Viewers are never allowed to publish media.
func CanPublishMedia(role Role, mediaKind MediaKind, policy RoomPolicy, perms *UserPermissions) bool {
	if role == RoleViewer {
		return false
	}

	// Hosts and Co-hosts always have permission to publish media
	if role == RoleHost || role == RoleCoHost {
		return true
	}

	// Check individual permissions override if provided
	if perms != nil {
		switch mediaKind {
		case MediaKindAudio:
			if !perms.CanPublishAudio {
				return false
			}
		case MediaKindVideo:
			if !perms.CanPublishVideo {
				return false
			}
		case MediaKindScreen:
			if !perms.CanPublishScreen {
				return false
			}
		}
	}

	// Check room-wide policies
	switch mediaKind {
	case MediaKindAudio:
		return policy.AllowMic
	case MediaKindVideo:
		return policy.AllowCamera
	case MediaKindScreen:
		return policy.AllowScreenShare
	default:
		return false
	}
}

// CanModerate checks whether an actor role has authority to perform an action against a target role.
func CanModerate(actorRole Role, targetRole Role, action ModerationAction) bool {
	actorLevel := RoleLevel(actorRole)

	// Participants and Viewers cannot moderate
	if actorLevel < RoleLevel(RoleCoHost) {
		return false
	}

	switch action {
	case ActionEndRoom:
		// Only host can end room for all
		return actorRole == RoleHost

	case ActionUpdatePolicy, ActionAdmit:
		// Hosts and Co-hosts can update policy or admit from lobby
		return actorLevel >= RoleLevel(RoleCoHost)

	case ActionMute, ActionStopMedia, ActionKick:
		// Cannot moderate yourself or higher/equal tier
		// Host can moderate CoHost, Participant, Viewer.
		// CoHost can moderate Participant and Viewer.
		return actorLevel > RoleLevel(targetRole)

	default:
		return false
	}
}

// CanChat checks if participant is permitted to send room chat messages.
func CanChat(role Role, policy RoomPolicy, perms *UserPermissions) bool {
	if role == RoleHost || role == RoleCoHost {
		return true
	}
	if perms != nil && !perms.CanChat {
		return false
	}
	return policy.AllowChat
}

// CanReact checks if participant is permitted to send emoji reactions.
func CanReact(role Role, policy RoomPolicy, perms *UserPermissions) bool {
	if role == RoleHost || role == RoleCoHost {
		return true
	}
	if perms != nil && !perms.CanReact {
		return false
	}
	return policy.AllowReactions
}
