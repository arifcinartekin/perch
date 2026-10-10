# Perch Server. Build from the repository root:
#   docker build -f apps/server/Dockerfile -t perch/server .
#   docker run -p 8080:8080 -v perch-data:/data perch/server

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/reader/package.json packages/reader/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/extension/package.json apps/extension/
# better-sqlite3 ships prebuilt binaries, so no install scripts are needed
# (and the extension's postinstall can't run without its sources).
RUN npm ci --ignore-scripts
COPY packages/core packages/core
COPY packages/reader packages/reader
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build -w @perch/server && npm run build -w @perch/web

FROM node:22-alpine
# The commit this image is built from; CI sets it, and /api/v1/server reports it.
ARG PERCH_COMMIT=
LABEL org.opencontainers.image.source="https://github.com/arifcinartekin/perch" \
      org.opencontainers.image.revision="${PERCH_COMMIT}" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production \
    PERCH_COMMIT=${PERCH_COMMIT} \
    PORT=8080 \
    DATABASE_URL=/data/perch.db \
    PERCH_WEB_ROOT=/app/web
# Everything except the native SQLite driver is bundled into dist/main.js.
COPY --from=build /app/node_modules/better-sqlite3 node_modules/better-sqlite3
COPY --from=build /app/apps/server/dist dist
COPY --from=build /app/apps/server/drizzle drizzle
COPY --from=build /app/apps/web/dist web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/main.js"]
