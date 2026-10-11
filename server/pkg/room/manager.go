package room

import (
	"fmt"
	"sync"
	"time"

	"github.com/connected-framework/connected/server/pkg/config"
	"github.com/connected-framework/connected/server/pkg/permissions"
)

// RoomManager maintains active room instances and cleans up dormant empty rooms.
type RoomManager struct {
	mu                       sync.RWMutex
	rooms                    map[string]*Room
	emptySince               map[string]time.Time
	emptyRoomTTL             time.Duration
	defaultMaxParticipants   int
	defaultSessionTimeoutSec int
	defaultPolicies          permissions.RoomPolicy
	stopChan                 chan struct{}
	closeOnce                sync.Once
}

// NewRoomManager initializes a room manager with cleanup routine.
func NewRoomManager(cfg config.RoomConfig) *RoomManager {
	ttl := time.Duration(cfg.EmptyRoomTTLSec) * time.Second
	if ttl <= 0 {
		ttl = 60 * time.Second
	}

	rm := &RoomManager{
		rooms:                    make(map[string]*Room),
		emptySince:               make(map[string]time.Time),
		emptyRoomTTL:             ttl,
		defaultMaxParticipants:   cfg.DefaultMaxParticipants,
		defaultSessionTimeoutSec: cfg.DefaultSessionTimeoutSec,
		defaultPolicies: permissions.RoomPolicy{
			AllowCamera:      cfg.DefaultPolicies.AllowCamera,
			AllowMic:         cfg.DefaultPolicies.AllowMic,
			AllowScreenShare: cfg.DefaultPolicies.AllowScreenShare,
			AllowChat:        cfg.DefaultPolicies.AllowChat,
			AllowReactions:   cfg.DefaultPolicies.AllowReactions,
			RequireLobby:     cfg.DefaultPolicies.RequireLobby,
		},
		stopChan: make(chan struct{}),
	}

	go rm.startCleanupLoop()
	return rm
}

// GetOrCreateRoom retrieves an existing room or creates a new one with default policies.
func (rm *RoomManager) GetOrCreateRoom(roomID string) (*Room, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if room, ok := rm.rooms[roomID]; ok {
		delete(rm.emptySince, roomID)
		return room, nil
	}

	room := NewRoom(
		roomID,
		rm.defaultMaxParticipants,
		rm.defaultSessionTimeoutSec,
		rm.defaultPolicies,
		rm.onRoomEmptyCallback,
		rm.onRoomEndCallback,
	)

	rm.rooms[roomID] = room
	return room, nil
}

// GetRoom retrieves an existing room if active.
func (rm *RoomManager) GetRoom(roomID string) (*Room, bool) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	r, ok := rm.rooms[roomID]
	return r, ok
}

// RemoveRoom removes a room by ID and terminates all active participants.
func (rm *RoomManager) RemoveRoom(roomID string) error {
	rm.mu.Lock()
	room, ok := rm.rooms[roomID]
	if !ok {
		rm.mu.Unlock()
		return fmt.Errorf("room %q not found", roomID)
	}

	delete(rm.rooms, roomID)
	delete(rm.emptySince, roomID)
	rm.mu.Unlock()

	room.Close()
	return nil
}

// onRoomEmptyCallback is called when a room transitions to 0 active participants.
func (rm *RoomManager) onRoomEmptyCallback(roomID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if r, ok := rm.rooms[roomID]; ok {
		active, lobby := r.ParticipantCount()
		if active == 0 && lobby == 0 {
			rm.emptySince[roomID] = time.Now()
		}
	}
}

// onRoomEndCallback is called when a room's session countdown expires.
func (rm *RoomManager) onRoomEndCallback(roomID string) {
	_ = rm.RemoveRoom(roomID)
}

// startCleanupLoop runs a periodic sweep terminating rooms that exceed empty TTL.
func (rm *RoomManager) startCleanupLoop() {
	checkInterval := 1 * time.Second
	if rm.emptyRoomTTL < 2*time.Second {
		checkInterval = 200 * time.Millisecond
	}
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-rm.stopChan:
			return
		case now := <-ticker.C:
			rm.sweepEmptyRooms(now)
		}
	}
}

// SweepEmptyRooms manually sweeps empty rooms exceeding TTL.
func (rm *RoomManager) SweepEmptyRooms(now time.Time) {
	rm.sweepEmptyRooms(now)
}

// sweepEmptyRooms evaluates empty rooms and deletes those exceeding TTL.
func (rm *RoomManager) sweepEmptyRooms(now time.Time) {
	var toDelete []string

	rm.mu.RLock()
	for roomID, since := range rm.emptySince {
		if now.Sub(since) >= rm.emptyRoomTTL {
			if r, ok := rm.rooms[roomID]; ok {
				active, lobby := r.ParticipantCount()
				if active == 0 && lobby == 0 {
					toDelete = append(toDelete, roomID)
				}
			}
		}
	}
	rm.mu.RUnlock()

	for _, roomID := range toDelete {
		rm.mu.Lock()
		if r, ok := rm.rooms[roomID]; ok {
			active, lobby := r.ParticipantCount()
			if active == 0 && lobby == 0 {
				delete(rm.rooms, roomID)
				delete(rm.emptySince, roomID)
				rm.mu.Unlock()
				r.Close()
				continue
			} else {
				delete(rm.emptySince, roomID)
			}
		}
		rm.mu.Unlock()
	}
}

// ActiveRoomsCount returns the number of currently active rooms.
func (rm *RoomManager) ActiveRoomsCount() int {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return len(rm.rooms)
}

// Close gracefully stops the cleanup loop and terminates all rooms.
func (rm *RoomManager) Close() {
	rm.closeOnce.Do(func() {
		close(rm.stopChan)

		rm.mu.Lock()
		toClose := make([]*Room, 0, len(rm.rooms))
		for _, r := range rm.rooms {
			toClose = append(toClose, r)
		}
		rm.rooms = make(map[string]*Room)
		rm.emptySince = make(map[string]time.Time)
		rm.mu.Unlock()

		for _, r := range toClose {
			r.Close()
		}
	})
}
