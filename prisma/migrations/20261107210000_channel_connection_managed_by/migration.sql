-- Who runs each channel-manager connection: OSTA (set up from the Osta console on the
-- master Beds24 account) or ENTERPRISE (the customer's own Beds24 account, from their Hub).
ALTER TABLE "ChannelConnection" ADD COLUMN "managedBy" TEXT NOT NULL DEFAULT 'ENTERPRISE';

-- Existing rows: OSTA when the Osta console set them up. Before 2026-10-14 only the Osta
-- console could create a connection; since then its route logs "set up by Osta platform
-- admin" into the tenant's trail against the connection's id.
UPDATE "ChannelConnection" c
SET "managedBy" = 'OSTA'
WHERE c."createdAt" < TIMESTAMP '2026-10-14 00:00:00'
   OR EXISTS (
     SELECT 1 FROM "UserActivityLog" l
     WHERE l."entityType" = 'ChannelConnection'
       AND l."entityId" = c."id"
       AND l."description" LIKE '%set up by Osta platform admin%'
   );
