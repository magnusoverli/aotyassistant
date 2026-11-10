FROM tailscale/tailscale:v1.104.4@sha256:ed6480b33c6eb67c9cbd203ed42b9fb57e361986725b6856def71b7a3d9e276c AS tailscale
FROM node:26.13.0-alpine3.24@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts ./
COPY src ./src
COPY web ./web
RUN npm run build && npm prune --omit=dev

FROM node:26.13.0-alpine3.24@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216
ARG BUILD_VERSION=2.0.4
ARG BUILD_ARCH=amd64
LABEL io.hass.version="$BUILD_VERSION" io.hass.type="app" io.hass.arch="$BUILD_ARCH" \
      org.opencontainers.image.source="https://github.com/magnusoverli/doom-room" \
      org.opencontainers.image.title="Doom Room" \
      org.opencontainers.image.description="Turn-based music sharing for Home Assistant, powered by Music Assistant." \
      org.opencontainers.image.version="$BUILD_VERSION" \
      org.opencontainers.image.licenses="MIT"
RUN apk add --no-cache su-exec ffmpeg ca-certificates
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscaled /usr/local/bin/
WORKDIR /app
ENV NODE_ENV=production PORT=3000 LISTEN_HOST=0.0.0.0 DATA_DIR=/data TAILSCALE_BUNDLED=1
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY LICENSE ./LICENSE
COPY licenses ./licenses
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000 8099
ENTRYPOINT ["/app/docker-entrypoint.sh"]
