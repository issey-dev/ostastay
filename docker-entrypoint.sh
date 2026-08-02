#!/bin/sh
# Runs before the server on every container start.
set -e

# Applying migrations on boot (rather than as a separate deploy step) is safe here
# because this is a single-instance SQLite deployment: there is no second container that
# could race this one, and `migrate deploy` only ever applies pending migrations forward
# — it never resets or drops. A multi-instance deployment would need this moved into a
# one-shot job instead.
echo "→ Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy

# The uploads directory lives on a named volume; a brand-new volume mounts empty and the
# subdirectory the storage layer expects would otherwise be missing until the first
# write. Creating it here keeps the first eRegistration photo upload from failing.
mkdir -p /app/storage/eregistration-uploads

echo "→ Starting OstaStay on port ${PORT:-3000}"
exec "$@"
