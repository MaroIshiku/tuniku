FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.client.json tsconfig.server.json ./
COPY vite.config.ts vitest.config.ts ./
COPY design-system ./design-system
COPY public ./public
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev \
    && mkdir -p /runtime-data \
    && chmod 0700 /runtime-data \
    && chown -R 1000:1000 /runtime-data

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e AS runtime
ARG VERSION=0.3.6
ARG BUILD_DATE=development
ARG GIT_SHA=development
ENV NODE_ENV=production \
    TUNIKU_PORT=8080 \
    TUNIKU_DATA_PATH=/data \
    TUNIKU_VERSION=${VERSION} \
    TUNIKU_BUILD_DATE=${BUILD_DATE} \
    TUNIKU_GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="Tuniku" \
      org.opencontainers.image.description="Secure, self-hosted Gluetun web interface" \
      org.opencontainers.image.source="https://github.com/MaroIshiku/tuniku" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"
WORKDIR /app
COPY --from=build --chown=1000:1000 /runtime-data /data
COPY --from=build --chown=1000:1000 /app/package.json /app/package-lock.json ./
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/dist ./dist
USER 1000:1000
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8080/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["dist/server/index.js"]
