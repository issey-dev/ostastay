-- Marks charges keyed in through Fast Post so its History can list them.
ALTER TABLE "FolioLineItem" ADD COLUMN "postedVia" TEXT;

-- Postings made before the marker existed: Fast Post wrote one POS/CREATE activity row per line.
UPDATE "FolioLineItem" SET "postedVia" = 'FAST_POST'
WHERE "id" IN (
  SELECT "entityId" FROM "UserActivityLog"
  WHERE "module" = 'POS' AND "entityType" = 'FolioLineItem' AND "action" = 'CREATE' AND "entityId" IS NOT NULL
);

CREATE INDEX "FolioLineItem_postedVia_date_idx" ON "FolioLineItem"("postedVia", "date");
