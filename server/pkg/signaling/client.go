package signaling

import (
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 1024 * 1024 // 1 MB
)

// Client encapsulates an active WebSocket connection and its send queue.
type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	send      chan []byte
	peerID    string
	roomID    string
	mu        sync.RWMutex
	closed    bool
	closeOnce sync.Once
}

// NewClient creates a new signaling client.
func NewClient(hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		hub:    hub,
		conn:   conn,
		send:   make(chan []byte, 256),
		closed: false,
	}
}

// Send enqueues a raw message for transmission over the WebSocket.
func (c *Client) Send(msg []byte) error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.closed {
		return fmt.Errorf("client is closed")
	}

	select {
	case c.send <- msg:
		return nil
	default:
		return fmt.Errorf("send buffer full for client %s", c.peerID)
	}
}

// Close closes the WebSocket connection and marks the client terminated.
func (c *Client) Close() error {
	var err error
	c.closeOnce.Do(func() {
		c.mu.Lock()
		c.closed = true
		c.mu.Unlock()

		close(c.send)
		err = c.conn.Close()
	})
	return err
}

// ReadPump continuously pulls inbound messages from the WebSocket.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.Unregister(c)
		_ = c.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		c.hub.HandleMessage(c, message)
	}
}

// WritePump continuously pumps outbound messages and periodic heartbeats to the WebSocket.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			if _, err := w.Write(message); err != nil {
				return
			}
			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
