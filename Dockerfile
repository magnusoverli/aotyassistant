FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts ./
COPY src ./src
COPY web ./web
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ARG BUILD_VERSION=0.3.12
ARG BUILD_ARCH=amd64
LABEL io.hass.version="$BUILD_VERSION" io.hass.type="app" io.hass.arch="$BUILD_ARCH" \
      org.opencontainers.image.source="https://github.com/magnusoverli/aotyassistant" \
      org.opencontainers.image.title="Albums of the Year"
RUN apk add --no-cache su-exec ffmpeg
WORKDIR /app
ENV NODE_ENV=production PORT=3000 LISTEN_HOST=0.0.0.0 DATA_DIR=/data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000 8099
ENTRYPOINT ["/app/docker-entrypoint.sh"]
