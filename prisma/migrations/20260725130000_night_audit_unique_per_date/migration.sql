-- Enforce one PropertyNightAuditLog row per (property, business date). The run route now
-- claims this row atomically (IN_PROGRESS -> COMPLETED/FAILED) so a concurrent or retried
-- Night Audit can never double-post charges or double-roll the business date.

-- Deduplicate any historical rows first (the old code inserted a separate row per attempt,
-- so a date that failed then completed could have several) — keep the most authoritative
-- one per (propertyId, auditDate): COMPLETED > IN_PROGRESS > FAILED, then most recent.
DELETE FROM "PropertyNightAuditLog"
WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id",
      ROW_NUMBER() OVER (
        PARTITION BY "propertyId", "auditDate"
        ORDER BY
          CASE "status" WHEN 'COMPLETED' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END ASC,
          "executedAt" DESC
      ) AS rn
    FROM "PropertyNightAuditLog"
  ) WHERE rn = 1
);

CREATE UNIQUE INDEX "PropertyNightAuditLog_propertyId_auditDate_key"
  ON "PropertyNightAuditLog"("propertyId", "auditDate");
