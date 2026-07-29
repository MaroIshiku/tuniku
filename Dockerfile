FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.client.json tsconfig.server.json ./
COPY vite.config.ts vitest.config.ts ./
COPY design-system ./design-system
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
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
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server/index.js"]
