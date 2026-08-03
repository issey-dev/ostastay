#!/bin/sh
# Runs before the server on every container start.
set -e

# Applying migrations on boot (rather than as a separate deploy step): `migrate deploy`
# only ever applies pending migrations forward — it never resets or drops — and on
# PostgreSQL Prisma serializes concurrent runs with an advisory lock, so scaled replicas
# booting together do not race each other.
echo "→ Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy

# The platform's own furniture: the INTERNAL "Osta" enterprise (the admin side that
# manages customer enterprises and channel-manager connections) and its system roles
# exist by default on every deployment — no manual step. Idempotent; creates NO user
# (accounts come from scripts/bootstrap-admin.ts, which requires a real password).
echo "→ Ensuring the Osta platform enterprise exists..."
node dist-scripts/scripts/ensure-platform.js

# The uploads directory lives on a named volume; a brand-new volume mounts empty and the
# subdirectory the storage layer expects would otherwise be missing until the first
# write. Creating it here keeps the first eRegistration photo upload from failing.
mkdir -p /app/storage/eregistration-uploads

echo "→ Starting OstaStay on port ${PORT:-3000}"
exec "$@"
