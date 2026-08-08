# syntax=docker/dockerfile:1

# Debian slim rather than Alpine. Prisma's query engine and better-sqlite3's native
# binding both expect glibc + openssl; the musl builds are a recurring source of
# "query engine not found" failures at boot, which is a poor trade for ~80MB.
FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*


# ── deps ─────────────────────────────────────────────────────────────────────
# Full install including devDependencies: the build needs next, prisma, and tsc.
FROM base AS deps
WORKDIR /app
# unzip: puppeteer's postinstall (below) downloads Chromium as a zip archive and has no
# pure-JS fallback extractor unless the optional `yauzl` dependency is present — without
# a system unzip, `npm ci` fails outright rather than silently degrading. Confined to
# this stage — it doesn't reach the runtime image. (python3/make/g++ used to live here
# too, for better-sqlite3's native binding — removed along with the SQLite driver
# adapters once the app finished moving to PostgreSQL-only; nothing left in
# package.json needs a C toolchain to install.)
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/*
# puppeteer's postinstall downloads a matching Linux Chromium build during `npm ci`.
# Pinned to a project-local path (rather than the default ~/.cache/puppeteer under
# whichever $HOME the build runs as) so the runner stage below can COPY it by a known,
# stable path instead of guessing.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
COPY package.json package-lock.json ./
RUN npm ci


# ── builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next build` runs with NODE_ENV=production, which makes src/lib/jwt-secret.ts throw at
# import time when JWT_SECRET is unset — that would fail the build, not just the runtime.
# This placeholder exists purely to get the module graph to load during compilation; the
# real secret is injected at runtime from the compose env_file and this value is never
# baked into the output. The same applies to DATABASE_URL: Prisma's client requires the
# variable to be present even when no query runs during the build.
ENV JWT_SECRET="placeholder-for-build-only-overridden-at-runtime" \
    DATABASE_URL="file:/tmp/build-placeholder.db"

RUN npx prisma generate
RUN npm run build
# The runtime image has no TypeScript, so operator scripts are compiled here instead.
RUN npx tsc -p tsconfig.scripts.json


# ── runner ───────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# Chromium's own runtime shared libraries — headless Chrome (used to render stationery
# documents to PDF, see src/lib/stationery-pdf.ts) needs these present even though
# nothing else in the app does. Standard Debian dependency list for running Chrome
# headless in a container (no X server, no system Chrome package).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
# The headless Chromium build puppeteer downloaded during `npm ci` in the deps stage —
# see PUPPETEER_CACHE_DIR above. Standalone tracing only follows the JS import graph, so
# this binary (never `import`ed, only spawned) has to be carried over explicitly, the
# same reasoning as the prisma/bcryptjs copies below.
COPY --from=deps --chown=nextjs:nodejs /app/.cache/puppeteer ./.cache/puppeteer
# Standalone emits its own minimal node_modules and server.js at the root.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Standalone tracing pulls in @prisma/client but NOT the prisma CLI, and the entrypoint
# runs `migrate deploy` on every boot — so the CLI, the generated client, the engines,
# and the migration history all have to be carried over explicitly.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/dist-scripts ./dist-scripts
# bcryptjs is bundled INTO Next's server chunks, so standalone tracing leaves it out of
# node_modules entirely. The app is fine; the bootstrap script is not, because it runs as
# its own plain-node process and resolves its imports the normal way. Dependency-free
# pure JS, so copying the package directory alone is sufficient.
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
# Strip any CR before chmod: this repo is developed on Windows, and a checkout that
# converts the script to CRLF makes the kernel look for an interpreter named "/bin/sh\r",
# failing with a baffling "no such file or directory" on an obviously present file.
# .gitattributes pins LF too — this is the belt to that braces.
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

# /data holds the SQLite file and /app/storage the eRegistration ID photos. Both are
# mount points for named volumes; creating them here owned by the app user is what lets
# the non-root process write to a freshly created volume on first boot.
RUN mkdir -p /data /app/storage/eregistration-uploads \
 && chown -R nextjs:nodejs /data /app/storage

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
