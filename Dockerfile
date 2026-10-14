# ==============================================================================
# Meetrix WebRTC All-in-One Container Image (Alpine Linux)
# Features:
#   - Go Media Server & Pion WebRTC SFU (HTTP/HTTPS/WSS)
#   - Embedded STUN/TURN Server (UDP 3478)
#   - Google Meet-style Demo Web Application served via Nginx (HTTPS)
#   - Shared volume mount point for SSL/TLS certificates (/etc/meetrix/certs)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Go Media Server binary
# ------------------------------------------------------------------------------
FROM golang:alpine AS go-builder

WORKDIR /build

RUN apk add --no-cache git ca-certificates tzdata

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o meetrix-server \
    ./cmd/server

# ------------------------------------------------------------------------------
# Stage 2: Build TypeScript SDK & Demo Web Application
# ------------------------------------------------------------------------------
FROM node:20-alpine AS web-builder

WORKDIR /build

# Copy root workspace manifests
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY examples/ ./examples/
COPY docs/package.json ./docs/package.json

RUN npm ci

# Build Core SDK and Demo Web UI
RUN npm run build --workspace=@meetrix/core
RUN npm run build --workspace=@meetrix/example-demo-web

# ------------------------------------------------------------------------------
# Stage 3: Alpine Linux Runtime with Nginx and Meetrix SFU
# ------------------------------------------------------------------------------
FROM alpine:3.20 AS runtime

LABEL org.opencontainers.image.title="Meetrix WebRTC Media Server & Demo" \
      org.opencontainers.image.description="All-in-one WebRTC SFU, embedded STUN/TURN, and demo web application over HTTPS" \
      org.opencontainers.image.source="https://github.com/IsmaCortGtz/meetrix" \
      org.opencontainers.image.licenses="MIT"

# Install runtime dependencies
RUN apk add --no-cache \
    nginx \
    ca-certificates \
    openssl \
    tzdata \
    bash \
    curl

# Create application, web, certificate, and nginx template directories
RUN mkdir -p /app \
    /var/www/meetrix \
    /etc/meetrix/certs \
    /etc/meetrix/nginx \
    /run/nginx \
    /var/log/nginx

# Copy Go server binary and configuration
COPY --from=go-builder /build/meetrix-server /app/meetrix-server
COPY server/config.json /app/config.json

# Copy compiled Demo Web static assets
COPY --from=web-builder /build/examples/demo-web/dist /var/www/meetrix

# Copy Nginx virtual host templates and entrypoint script
COPY docker/nginx-ssl.conf /etc/meetrix/nginx/nginx-ssl.conf
COPY docker/nginx-plain.conf /etc/meetrix/nginx/nginx-plain.conf
COPY docker/nginx-ssl.conf /etc/nginx/http.d/default.conf
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Certificate mount point volume
VOLUME ["/etc/meetrix/certs"]

# Non-sensitive default configurations (MEETRIX_TLS_ENABLED: auto | true | false)
ENV MEETRIX_HTTP_PORT=8080 \
    MEETRIX_TLS_ENABLED=auto \
    MEETRIX_PUBLIC_IP=auto \
    MEETRIX_TURN_ENABLED=true \
    MEETRIX_TURN_PORT=3478 \
    MEETRIX_WEBRTC_PORT_MIN=50000 \
    MEETRIX_WEBRTC_PORT_MAX=50200

# Network Ports:
# 80/tcp:          Nginx HTTP (serves Web UI & WS proxy in HTTP mode, redirects in HTTPS mode)
# 443/tcp:         Nginx HTTPS (Demo Web UI & WSS reverse proxy in HTTPS mode)
# 8080/tcp:        Meetrix Media Server (Direct HTTP or HTTPS/WSS listener)
# 3478/udp:        Embedded STUN/TURN Server
# 50000-50200/udp: WebRTC SFU Ephemeral Media Ports
EXPOSE 80/tcp 443/tcp 8080/tcp 3478/udp 50000-50200/udp

ENTRYPOINT ["/app/entrypoint.sh"]
