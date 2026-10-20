# syntax=docker/dockerfile:1

ARG NODE_VERSION=22-bookworm-slim

# ==============================================================================
# Build Stage: Install dependencies and compile TypeScript
# ==============================================================================
FROM node:${NODE_VERSION} AS builder

WORKDIR /app

# Install build dependencies for native addons (e.g. better-sqlite3 / node-gyp fallback)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy package manifests for reproducible dependency installation
COPY package*.json ./

# Install all dependencies (including devDependencies required for compilation)
RUN npm ci

# Copy TypeScript and Nest CLI configuration files
COPY tsconfig*.json nest-cli.json ./

# Copy application source code (includes database migrations)
COPY src/ ./src/

# Compile TypeScript to dist/ and copy assets (e.g. SQL migrations)
RUN npm run build

# Prune development dependencies to keep production image size minimal
RUN npm prune --omit=dev

# ==============================================================================
# Production Stage: Minimal runtime container
# ==============================================================================
FROM node:${NODE_VERSION} AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package definition for ESM support ("type": "module")
COPY --chown=node:node package*.json ./

# Copy production node_modules and compiled distribution from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

# Copy static frontend assets served by Fastify at runtime
COPY --chown=node:node public ./public

# Run as non-root user for security
USER node

# Expose HTTP port
EXPOSE 3000

# Health check using built-in Node fetch against the /api/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"

# Launch the NestJS application
CMD ["node", "dist/main.js"]
