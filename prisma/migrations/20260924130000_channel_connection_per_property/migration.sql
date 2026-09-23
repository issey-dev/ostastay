-- Hub Setup, Phase 4c (.agents/docs/HUB_SETUP_PLAN.md): one channel-manager connection per
-- PROPERTY (owner, 2026-09-23 — supersedes the per-enterprise invite code). A connection
-- now names its property; its ChannelPropertyLink is that property's link, one per
-- connection; exchange-log rows carry the property so each property's Logs screen scopes
-- to its own.
--
-- Existing rows: a connection with one linked property takes that property. A connection
-- linked to SEVERAL properties is split — each further property gets its own connection
-- row carrying the same (encrypted) credential, and its link, inbound bookings and log
-- rows move with it. The webhook URL stays with the original (its hash is unique): the
-- split-off rows need a new URL from the Osta console. A connection linked to no property
-- cannot be placed and is removed (its log rows survive, connection-less, as they would
-- after any removal). No live enterprise had a connection when this shipped.

ALTER TABLE "ChannelConnection" ADD COLUMN "propertyId" TEXT;
ALTER TABLE "ChannelSyncLog" ADD COLUMN "propertyId" TEXT;

-- 1. Which property each link's connection row will be: the first-created link keeps the
--    original connection, every later link of the same connection gets a new one.
CREATE TEMP TABLE conn_split AS
SELECT l."id" AS link_id, l."connectionId" AS old_conn, l."propertyId" AS property_id,
       CASE WHEN ROW_NUMBER() OVER (PARTITION BY l."connectionId" ORDER BY l."createdAt", l."id") = 1
            THEN l."connectionId" ELSE gen_random_uuid()::text END AS new_conn
FROM "ChannelPropertyLink" l;

-- 2. Clone the connection for every split-off property.
INSERT INTO "ChannelConnection" (
  "id", "enterpriseId", "propertyId", "provider", "name", "refreshToken", "lastTokenRefreshAt",
  "accessToken", "accessTokenExpiresAt", "webhookTokenHash", "status", "lastHealthCheckAt", "lastError",
  "rateLimitTotal", "rateLimitRemaining", "rateLimitResetsAt", "rateLimitObservedAt",
  "rateLimitPauseThreshold", "pollLookbackHours", "createdAt", "updatedAt"
)
SELECT s.new_conn, c."enterpriseId", s.property_id, c."provider", c."name" || ' — ' || p."code", c."refreshToken", c."lastTokenRefreshAt",
       c."accessToken", c."accessTokenExpiresAt", NULL, c."status", c."lastHealthCheckAt", c."lastError",
       c."rateLimitTotal", c."rateLimitRemaining", c."rateLimitResetsAt", c."rateLimitObservedAt",
       c."rateLimitPauseThreshold", c."pollLookbackHours", c."createdAt", CURRENT_TIMESTAMP
FROM conn_split s
JOIN "ChannelConnection" c ON c."id" = s.old_conn
JOIN "Property" p ON p."id" = s.property_id
WHERE s.new_conn <> s.old_conn;

-- 3. The original keeps its first property.
UPDATE "ChannelConnection" c SET "propertyId" = s.property_id
FROM conn_split s WHERE s.old_conn = c."id" AND s.new_conn = c."id";

-- 4. Move each split-off property's link, inbound bookings and log rows to its new row.
UPDATE "ChannelPropertyLink" l SET "connectionId" = s.new_conn
FROM conn_split s WHERE s.link_id = l."id" AND s.new_conn <> s.old_conn;

UPDATE "ChannelInboundBooking" b SET "connectionId" = s.new_conn
FROM conn_split s
WHERE b."connectionId" = s.old_conn AND b."propertyId" = s.property_id AND s.new_conn <> s.old_conn;

-- 5. A connection that covered no property cannot be placed.
DELETE FROM "ChannelConnection" WHERE "propertyId" IS NULL;

-- 6. Log rows take their connection's property.
UPDATE "ChannelSyncLog" g SET "propertyId" = c."propertyId"
FROM "ChannelConnection" c WHERE g."connectionId" = c."id";

DROP TABLE conn_split;

-- 7. Constraints.
ALTER TABLE "ChannelConnection" ALTER COLUMN "propertyId" SET NOT NULL;
CREATE UNIQUE INDEX "ChannelConnection_propertyId_key" ON "ChannelConnection"("propertyId");
CREATE UNIQUE INDEX "ChannelPropertyLink_connectionId_key" ON "ChannelPropertyLink"("connectionId");
CREATE INDEX "ChannelSyncLog_propertyId_createdAt_idx" ON "ChannelSyncLog"("propertyId", "createdAt");

ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelSyncLog" ADD CONSTRAINT "ChannelSyncLog_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
