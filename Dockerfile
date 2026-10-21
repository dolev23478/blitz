# Dependency image is restored from Git vendor assets by npm run image:build.
# No Docker Hub, Debian, PyPI or Hugging Face downloads occur in this Dockerfile.
FROM blitz-deps:node24-radio-v1 AS builder
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
# Lifecycle scripts are disabled: npm must not download GitHub prebuilds/Node headers.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund --prefer-offline
# Build this native addon using headers/toolchain already inside the vendored image.
RUN --network=none cd node_modules/better-sqlite3 && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --release --nodedir=/usr/local
# Compile with tsc (nest build): Nest DI needs the decorator metadata only tsc emits.
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/
RUN --network=none npm run build

RUN --network=none --mount=type=cache,target=/root/.npm npm prune --omit=dev --ignore-scripts --offline --no-audit --no-fund

FROM blitz-deps:node24-radio-v1 AS runner
ARG RADIO_MODEL=tiny
WORKDIR /app
COPY --chown=node:node vendor/radio-models ./vendor/radio-models
COPY --chown=node:node scripts/check-radio-offline.py ./scripts/check-radio-offline.py
COPY --chown=node:node scripts/radio-once.mjs scripts/radio-pipeline.mjs ./scripts/
ENV NODE_ENV=production \
    PORT=3000 \
    DICTIONARIES_DIR=/app/dictionaries \
    OUTPUT_DIR=/app/output \
    RADIO_MODELS_DIR=vendor/radio-models \
    RADIO_MODEL=${RADIO_MODEL}
COPY --chown=node:node package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node dictionaries ./dictionaries
RUN --network=none mkdir -p /app/output /app/.radio && chown node:node /app/output /app/.radio
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"
CMD ["node", "dist/main.js"]
