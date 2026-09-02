# Lexi — self-host image. Two stages: build with full deps, run with prod deps.
# Uses `next start` (not standalone output) so libSQL's native module is always
# present — no output-file-tracing surprises.

# ---- build ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build with production settings. No secrets needed at build time (all routes are
# dynamic / server-rendered on demand).
ENV NODE_ENV=production
RUN npm run build

# ---- run ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Only production deps at runtime (drops eslint/vitest/etc.)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Build output + static assets + config.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
# Migration/ingest scripts run in-place against the live DB inside the container.
COPY --from=builder /app/scripts ./scripts
# Seed content (collections + questions) read by the public-collections ingest.
COPY --from=builder /app/content ./content
# The SQLite DB lives here; mounted as a volume at runtime so data persists
# across container restarts/rebuilds.
RUN mkdir -p /app/.data
# Run as the unprivileged `node` user (uid/gid 1000) that the base image ships.
# Everything under /app (including .data, so the DB + backups are writable even
# when nothing is mounted) is handed to it. On the host, the bind-mounted data
# dir must be owned by uid 1000 — see deploy/SERVER-CHECKLIST.md.
RUN chown -R node:node /app
USER node
EXPOSE 3000
# Start Next directly (no `npm` parent process): PID 1 is node itself, so
# SIGTERM from `docker stop` reaches the server and shutdown is clean.
CMD ["node", "node_modules/next/dist/bin/next", "start"]
