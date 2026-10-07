# Perch Server. Build from the repository root:
#   docker build -f apps/server/Dockerfile -t perch/server .
#   docker run -p 8080:8080 -v perch-data:/data perch/server

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/extension/package.json apps/extension/
# better-sqlite3 ships prebuilt binaries, so no install scripts are needed
# (and the extension's postinstall can't run without its sources).
RUN npm ci --ignore-scripts
COPY packages/core packages/core
COPY apps/server apps/server
RUN npm run build -w @perch/server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_URL=/data/perch.db
# Everything except the native SQLite driver is bundled into dist/main.js.
COPY --from=build /app/node_modules/better-sqlite3 node_modules/better-sqlite3
COPY --from=build /app/apps/server/dist dist
COPY --from=build /app/apps/server/drizzle drizzle
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/main.js"]
