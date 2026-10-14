#!/bin/bash
set -e

CERT_DIR="/etc/meetrix/certs"
CERT_FILE="${MEETRIX_TLS_CERT:-$CERT_DIR/cert.pem}"
KEY_FILE="${MEETRIX_TLS_KEY:-$CERT_DIR/key.pem}"

echo "=========================================================="
echo " Starting Meetrix WebRTC Media Server (Standalone)"
echo "=========================================================="

mkdir -p "$CERT_DIR"

# Check and symlink standard certificate alternatives if present
if [ ! -f "$CERT_FILE" ]; then
    if [ -f "$CERT_DIR/fullchain.pem" ]; then
        ln -sf "$CERT_DIR/fullchain.pem" "$CERT_FILE"
    elif [ -f "$CERT_DIR/tls.crt" ]; then
        ln -sf "$CERT_DIR/tls.crt" "$CERT_FILE"
    fi
fi

if [ ! -f "$KEY_FILE" ]; then
    if [ -f "$CERT_DIR/privkey.pem" ]; then
        ln -sf "$CERT_DIR/privkey.pem" "$KEY_FILE"
    elif [ -f "$CERT_DIR/tls.key" ]; then
        ln -sf "$CERT_DIR/tls.key" "$KEY_FILE"
    fi
fi

# Determine if certificates currently exist
HAS_CERTS=false
if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    HAS_CERTS=true
fi

# Normalize MEETRIX_TLS_ENABLED setting (auto, true, false)
TLS_SETTING="${MEETRIX_TLS_ENABLED:-auto}"
TLS_SETTING=$(echo "$TLS_SETTING" | tr '[:upper:]' '[:lower:]')

USE_TLS=false
if [ "$TLS_SETTING" = "true" ] || [ "$TLS_SETTING" = "1" ] || [ "$TLS_SETTING" = "yes" ]; then
    USE_TLS=true
    if [ "$HAS_CERTS" = false ]; then
        echo "[Meetrix Entrypoint] TLS explicitly enabled, but no certificates found in $CERT_DIR"
        echo "[Meetrix Entrypoint] Generating temporary self-signed certificate for testing..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$KEY_FILE" \
            -out "$CERT_FILE" \
            -subj "/C=US/ST=Dev/L=Local/O=Meetrix/CN=localhost" \
            > /dev/null 2>&1
        echo "[Meetrix Entrypoint] Self-signed certificates generated at $CERT_FILE and $KEY_FILE."
        HAS_CERTS=true
    fi
elif [ "$TLS_SETTING" = "false" ] || [ "$TLS_SETTING" = "0" ] || [ "$TLS_SETTING" = "no" ]; then
    USE_TLS=false
    echo "[Meetrix Entrypoint] TLS explicitly disabled (HTTP mode)."
else
    # auto mode: enable TLS only if certificates were mounted/found
    if [ "$HAS_CERTS" = true ]; then
        USE_TLS=true
        echo "[Meetrix Entrypoint] TLS certificates detected in $CERT_DIR. Running in HTTPS mode."
    else
        USE_TLS=false
        echo "[Meetrix Entrypoint] No TLS certificates found in $CERT_DIR. Running in HTTP mode."
        echo "[Meetrix Entrypoint] (To enable TLS, mount certificates to $CERT_DIR or set MEETRIX_TLS_ENABLED=true)"
    fi
fi

# Ensure correct permissions on certificate files when TLS is enabled
if [ "$USE_TLS" = true ]; then
    chmod 600 "$KEY_FILE" 2>/dev/null || true
    chmod 644 "$CERT_FILE" 2>/dev/null || true
fi

MEETRIX_PID=0

cleanup() {
    echo "[Meetrix Entrypoint] Received termination signal. Stopping server..."
    if [ "$MEETRIX_PID" -ne 0 ]; then
        kill -TERM "$MEETRIX_PID" 2>/dev/null || true
    fi
    wait
    echo "[Meetrix Entrypoint] Shutdown complete."
    exit 0
}

trap cleanup SIGTERM SIGINT SIGQUIT

# Start Meetrix Go Media Server in background
SERVER_PORT="${MEETRIX_HTTP_PORT:-8080}"
if [ "$USE_TLS" = true ]; then
    echo "[Meetrix Entrypoint] Starting Meetrix Go Media Server on port $SERVER_PORT (HTTPS/WSS)..."
    export MEETRIX_TLS_ENABLED=true
    /app/meetrix-server -config /app/config.json -tls=true -tls-cert "$CERT_FILE" -tls-key "$KEY_FILE" &
else
    echo "[Meetrix Entrypoint] Starting Meetrix Go Media Server on port $SERVER_PORT (HTTP/WS)..."
    export MEETRIX_TLS_ENABLED=false
    /app/meetrix-server -config /app/config.json -tls=false &
fi
MEETRIX_PID=$!

# Wait for background process
wait "$MEETRIX_PID"
cleanup

