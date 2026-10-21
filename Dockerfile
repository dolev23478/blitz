# syntax=docker/dockerfile:1

# Node 24, as used in development (@types/node 24, docs/ARCHITECTURE.md).
ARG NODE_VERSION=24-bookworm-slim

# ==============================================================================
# Build stage: install dependencies and compile TypeScript
# ==============================================================================
FROM node:${NODE_VERSION} AS builder

WORKDIR /app

# Toolchain for native addons: better-sqlite3 (via @mtcute/node) compiles when no prebuilt binary fits.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Package manifests first, so the dependency layer is cached between source changes
COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

# Compile with tsc (nest build): Nest DI needs the decorator metadata only tsc emits.
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/
RUN npm run build

# Keep only production dependencies for the runtime image
RUN npm prune --omit=dev

# ==============================================================================
# Runtime stage
# ==============================================================================
FROM node:${NODE_VERSION} AS runner

WORKDIR /app

# Local radio ASR runs in the same container; model downloads stay in /app/.radio.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ca-certificates libgomp1 \
  && rm -rf /var/lib/apt/lists/*
COPY requirements-radio.txt ./
RUN python3 -m venv /app/.venv-radio \
  && /app/.venv-radio/bin/python -m pip install --no-cache-dir -r requirements-radio.txt

# DICTIONARIES_DIR: read at runtime by the filter (src/dictionaries/load-dictionaries.ts).
# OUTPUT_DIR: the X scraper writes its JSON/HTML exports here (src/x-scraper/x-scraper.service.ts).
ENV NODE_ENV=production \
    PORT=3000 \
    DICTIONARIES_DIR=/app/dictionaries \
    OUTPUT_DIR=/app/output

# package.json is needed at runtime for ESM ("type": "module")
COPY --chown=node:node package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
# Dictionaries for filtering and language matching. Without them the first post fails.
COPY --chown=node:node dictionaries ./dictionaries

# Writable directory for the non-root user
RUN mkdir -p /app/output /app/.radio && chown node:node /app/output /app/.radio

USER node

EXPOSE 3000

# /api/health is public even when API_KEY is set
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "dist/main.js"]
