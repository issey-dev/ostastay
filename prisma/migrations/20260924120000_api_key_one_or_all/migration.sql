-- Hub Setup, Phase 4b (.agents/docs/HUB_SETUP_PLAN.md): a Booking API key covers ONE
-- property or ALL of its enterprise's properties — never a subset (owner, 2026-09-23; the
-- same rule as a user's work location). The WebsiteApiKeyProperty join becomes a nullable
-- WebsiteApiKey.propertyId, null meaning ALL.

ALTER TABLE "WebsiteApiKey" ADD COLUMN "propertyId" TEXT;

-- A key on exactly one property keeps that property.
UPDATE "WebsiteApiKey" k
SET "propertyId" = j."propertyId"
FROM (
  SELECT "keyId", MIN("propertyId") AS "propertyId"
  FROM "WebsiteApiKeyProperty"
  GROUP BY "keyId"
  HAVING COUNT(*) = 1
) j
WHERE j."keyId" = k."id";

-- A key on several properties becomes an ALL key (propertyId stays null): it served a
-- group portal, and one-property-or-ALL leaves no narrower choice that keeps the site
-- working. (No live enterprise held such a key when this shipped.)

-- A key on no property at all could never be used; revoke it rather than let "null" widen
-- it to ALL.
UPDATE "WebsiteApiKey" k
SET "status" = 'REVOKED', "revokedAt" = COALESCE(k."revokedAt", CURRENT_TIMESTAMP)
WHERE NOT EXISTS (SELECT 1 FROM "WebsiteApiKeyProperty" j WHERE j."keyId" = k."id")
  AND k."status" <> 'REVOKED';

DROP TABLE "WebsiteApiKeyProperty";

CREATE INDEX "WebsiteApiKey_propertyId_idx" ON "WebsiteApiKey"("propertyId");

ALTER TABLE "WebsiteApiKey" ADD CONSTRAINT "WebsiteApiKey_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
