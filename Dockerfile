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
# Only needed when better-sqlite3 has no prebuilt binary for this platform and falls
# back to compiling. Confined to this stage — none of it reaches the runtime image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
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
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
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
