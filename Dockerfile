FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
WORKDIR /app
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
    && chown -R 1000:1000 /runtime-data

FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e AS runtime
ARG VERSION=0.1.0
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
COPY --from=build /usr/local/bin/node /nodejs/bin/node
COPY --from=build --chown=1000:1000 /runtime-data /data
COPY --from=build --chown=1000:1000 /app/package.json /app/package-lock.json ./
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/dist ./dist
USER 1000:1000
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["dist/server/index.js"]
