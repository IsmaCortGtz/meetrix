package permissions

import (
	"testing"
)

func TestDefaultPermissionsForRole(t *testing.T) {
	hostPerms := DefaultPermissionsForRole(RoleHost)
	if !hostPerms.CanPublishAudio || !hostPerms.CanPublishVideo || !hostPerms.CanPublishScreen || !hostPerms.CanChat || !hostPerms.CanReact {
		t.Errorf("host should have all default permissions enabled")
	}

	partPerms := DefaultPermissionsForRole(RoleParticipant)
	if !partPerms.CanPublishAudio || !partPerms.CanPublishVideo || !partPerms.CanPublishScreen || !partPerms.CanChat || !partPerms.CanReact {
		t.Errorf("participant should have all default permissions enabled")
	}

	viewerPerms := DefaultPermissionsForRole(RoleViewer)
	if viewerPerms.CanPublishAudio || viewerPerms.CanPublishVideo || viewerPerms.CanPublishScreen {
		t.Errorf("viewer should not have publishing permissions")
	}
	if !viewerPerms.CanChat || !viewerPerms.CanReact {
		t.Errorf("viewer should be able to chat and react by default")
	}
}

func TestCanPublishMedia(t *testing.T) {
	policyAllAllowed := RoomPolicy{
		AllowCamera:      true,
		AllowMic:         true,
		AllowScreenShare: true,
	}

	policyMuted := RoomPolicy{
		AllowCamera:      false,
		AllowMic:         false,
		AllowScreenShare: false,
	}

	// Hosts and CoHosts bypass room locks
	if !CanPublishMedia(RoleHost, MediaKindAudio, policyMuted, nil) {
		t.Errorf("host should bypass audio mute policy")
	}
	if !CanPublishMedia(RoleCoHost, MediaKindVideo, policyMuted, nil) {
		t.Errorf("co-host should bypass video mute policy")
	}

	// Viewers can never publish media
	if CanPublishMedia(RoleViewer, MediaKindAudio, policyAllAllowed, nil) {
		t.Errorf("viewer must not be allowed to publish audio")
	}
	if CanPublishMedia(RoleViewer, MediaKindVideo, policyAllAllowed, nil) {
		t.Errorf("viewer must not be allowed to publish video")
	}

	// Participants respect room policy
	if !CanPublishMedia(RoleParticipant, MediaKindAudio, policyAllAllowed, nil) {
		t.Errorf("participant should publish audio when allowed by policy")
	}
	if CanPublishMedia(RoleParticipant, MediaKindAudio, policyMuted, nil) {
		t.Errorf("participant should not publish audio when locked by policy")
	}
	if CanPublishMedia(RoleParticipant, MediaKindVideo, policyMuted, nil) {
		t.Errorf("participant should not publish video when locked by policy")
	}

	// Participant personal permission override
	disallowAudio := &UserPermissions{CanPublishAudio: false, CanPublishVideo: true, CanPublishScreen: true}
	if CanPublishMedia(RoleParticipant, MediaKindAudio, policyAllAllowed, disallowAudio) {
		t.Errorf("participant should be blocked by personal permission override")
	}
	if !CanPublishMedia(RoleParticipant, MediaKindVideo, policyAllAllowed, disallowAudio) {
		t.Errorf("participant video should remain permitted")
	}
}

func TestCanModerate(t *testing.T) {
	// End room
	if !CanModerate(RoleHost, RoleParticipant, ActionEndRoom) {
		t.Errorf("host should be able to end room")
	}
	if CanModerate(RoleCoHost, RoleParticipant, ActionEndRoom) {
		t.Errorf("co-host must not be able to end room")
	}
	if CanModerate(RoleParticipant, RoleViewer, ActionEndRoom) {
		t.Errorf("participant must not be able to end room")
	}

	// Update policy and admit
	if !CanModerate(RoleHost, "", ActionUpdatePolicy) {
		t.Errorf("host should be able to update policy")
	}
	if !CanModerate(RoleCoHost, "", ActionUpdatePolicy) {
		t.Errorf("co-host should be able to update policy")
	}
	if CanModerate(RoleParticipant, "", ActionUpdatePolicy) {
		t.Errorf("participant must not be able to update policy")
	}

	if !CanModerate(RoleHost, "", ActionAdmit) {
		t.Errorf("host should be able to admit")
	}
	if !CanModerate(RoleCoHost, "", ActionAdmit) {
		t.Errorf("co-host should be able to admit")
	}
	if CanModerate(RoleParticipant, "", ActionAdmit) {
		t.Errorf("participant must not be able to admit")
	}

	// Target moderation: Mute, StopMedia, Kick
	// Host vs others
	if !CanModerate(RoleHost, RoleCoHost, ActionMute) {
		t.Errorf("host should be able to mute co-host")
	}
	if !CanModerate(RoleHost, RoleParticipant, ActionKick) {
		t.Errorf("host should be able to kick participant")
	}
	if CanModerate(RoleHost, RoleHost, ActionKick) {
		t.Errorf("host cannot kick another host")
	}

	// CoHost vs others
	if CanModerate(RoleCoHost, RoleHost, ActionMute) {
		t.Errorf("co-host cannot mute host")
	}
	if CanModerate(RoleCoHost, RoleCoHost, ActionMute) {
		t.Errorf("co-host cannot mute another co-host")
	}
	if !CanModerate(RoleCoHost, RoleParticipant, ActionMute) {
		t.Errorf("co-host should be able to mute participant")
	}
	if !CanModerate(RoleCoHost, RoleViewer, ActionKick) {
		t.Errorf("co-host should be able to kick viewer")
	}

	// Participant / Viewer cannot moderate
	if CanModerate(RoleParticipant, RoleViewer, ActionMute) {
		t.Errorf("participant cannot moderate viewer")
	}
	if CanModerate(RoleViewer, RoleParticipant, ActionMute) {
		t.Errorf("viewer cannot moderate participant")
	}
}

func TestCanChatAndReact(t *testing.T) {
	policyAllowed := RoomPolicy{AllowChat: true, AllowReactions: true}
	policyBlocked := RoomPolicy{AllowChat: false, AllowReactions: false}

	if !CanChat(RoleHost, policyBlocked, nil) {
		t.Errorf("host can always chat")
	}
	if !CanReact(RoleCoHost, policyBlocked, nil) {
		t.Errorf("co-host can always react")
	}

	if !CanChat(RoleParticipant, policyAllowed, nil) {
		t.Errorf("participant can chat when policy allows")
	}
	if CanChat(RoleParticipant, policyBlocked, nil) {
		t.Errorf("participant cannot chat when policy blocks")
	}

	if !CanReact(RoleViewer, policyAllowed, nil) {
		t.Errorf("viewer can react when policy allows")
	}
	if CanReact(RoleViewer, policyBlocked, nil) {
		t.Errorf("viewer cannot react when policy blocks")
	}
}
