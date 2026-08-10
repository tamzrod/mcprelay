# MCP Connector — production image (D-09).
#
# Multi-stage build:
#   1. build  — compiles TypeScript (strict) to dist/ with Node 22.
#   2. runtime — slim Node 22 image; ships only dist/ + production deps +
#      better-sqlite3 native bindings. No dev tooling, no source, no test code.
#
# The connector is a long-running single process. Secrets (master key,
# downstream API key, upstream URL) arrive via environment at runtime, never
# baked into the image. The SQLite credential store lives on a mounted volume
# (/data) so OAuth grants survive restart (G2/G6 restart-survival criterion).
#
# Build:  docker build -t mcprelay:phase4 .
# Run:    see docs/evidence/G6.md for the env+volume contract.

# ---- stage 1: build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# build-essential + python3 are required to compile better-sqlite3 native code.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- stage 2: runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# better-sqlite3 native module needs libstdc++ at runtime; base image provides it.
ENV NODE_ENV=production

# Install only production deps, then prune to the prebuilt/built tree from this
# stage (so the native binding matches the runtime image, not the build image).
COPY package.json package-lock.json ./
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && npm ci --omit=dev \
 && apt-get purge -y --auto-remove python3 make g++

# Compiled application (no source, no tests).
COPY --from=build /app/dist ./dist

# Persistent credential store on a mounted volume (encrypted SQLite, D-10).
RUN mkdir -p /data
VOLUME /data

# Non-root user; the volume must be writable by uid 1001.
RUN groupadd -r -g 1001 connector && useradd -r -u 1001 -g connector connector \
 && chown -R connector:connector /app /data
USER connector

EXPOSE 8789

# Runtime configuration via environment:
#   MCPRELAY_MASTER_KEY        (required, base64 32 bytes) — D-10 encryption key
#   MCPRELAY_CONNECTOR_API_KEY (required)                   — D-13 downstream bearer
#   MCPRELAY_UPSTREAM_URL      (default http://127.0.0.1:8788/mcp; set to Notion)
#   MCPRELAY_PUBLIC_BASE_URL   (required for OAuth redirect_uri behind TLS proxy)
#   MCPRELAY_PORT / MCPRELAY_HOST / MCPRELAY_DB_PATH        (defaults sane)
ENTRYPOINT ["node", "dist/connector.js"]
