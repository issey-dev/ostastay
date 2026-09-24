-- Hub Setup, Phase 2 (.agents/docs/HUB_SETUP_PLAN.md): the chart of accounts (groups,
-- subgroups, codes, generates), tax profiles and payment methods become PER PROPERTY — as
-- do the posting defaults, the Maldives tax switches and rates, the cashier defaults and
-- the Spa/Excursion outlet links (EnterpriseSettings → PropertySettings).
--
-- Method: every enterprise-level row is CLONED for each property of its enterprise; every
-- row that references one is re-pointed at ITS OWN property's clone (each referencing row
-- belongs to exactly one property); then the originals are deleted. That delete is the
-- safety net — a reference this migration missed would still point at an original, the
-- foreign key would refuse the delete, and the whole migration would roll back rather
-- than leave one property pointing into another property's chart.
--
-- Variant (owner, 2026-09-23): a subgroup that belongs to an OUTLET is cloned only to
-- that outlet's property, with its codes — a restaurant's codes are that property's
-- alone. The one exception is a code some OTHER property's records already use: that
-- property gets a copy too, so nothing it posted loses its code.

-- ── 1. New columns (nullable while they are filled) ──────────────────────────────────
ALTER TABLE "ChargeGroup" ADD COLUMN "propertyId" TEXT;
ALTER TABLE "ChargeSubgroup" ADD COLUMN "propertyId" TEXT;
ALTER TABLE "ChargeCode" ADD COLUMN "propertyId" TEXT;
ALTER TABLE "ChargeCodeGenerate" ADD COLUMN "propertyId" TEXT;
ALTER TABLE "TaxProfile" ADD COLUMN "propertyId" TEXT;
ALTER TABLE "PaymentMethod" ADD COLUMN "propertyId" TEXT;

ALTER TABLE "PropertySettings"
  ADD COLUMN "defaultAccommodationChargeCodeId" TEXT,
  ADD COLUMN "defaultGreenTaxChargeCodeId" TEXT,
  ADD COLUMN "commissionChargeCodeId" TEXT,
  ADD COLUMN "cityLedgerPaymentMethodId" TEXT,
  ADD COLUMN "spaOutletId" TEXT,
  ADD COLUMN "excursionOutletId" TEXT,
  ADD COLUMN "cashierDefaultFloat" DOUBLE PRECISION NOT NULL DEFAULT 300,
  ADD COLUMN "exchangeFromCurrency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "exchangeToCurrency" TEXT NOT NULL DEFAULT 'MVR',
  ADD COLUMN "greenTaxEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "greenTaxAdultAmount" DOUBLE PRECISION NOT NULL DEFAULT 12.00,
  ADD COLUMN "greenTaxChildAmount" DOUBLE PRECISION NOT NULL DEFAULT 6.00,
  ADD COLUMN "greenTaxStayBasis" TEXT NOT NULL DEFAULT 'ACTUAL',
  ADD COLUMN "greenTaxExemptAge" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "tgstEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "tgstRate" DOUBLE PRECISION NOT NULL DEFAULT 17.00,
  ADD COLUMN "serviceChargeEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "serviceChargeRate" DOUBLE PRECISION NOT NULL DEFAULT 10.00;

-- Every property gets a settings row (a property created after Phase 1 may have none).
INSERT INTO "PropertySettings" ("id", "propertyId", "updatedAt")
  SELECT gen_random_uuid()::text, p."id", CURRENT_TIMESTAMP
  FROM "Property" p
  WHERE NOT EXISTS (SELECT 1 FROM "PropertySettings" s WHERE s."propertyId" = p."id");

-- The old per-enterprise uniqueness would reject the clones.
DROP INDEX "ChargeGroup_enterpriseId_code_key";
DROP INDEX "ChargeSubgroup_enterpriseId_code_key";
DROP INDEX "ChargeCode_enterpriseId_code_key";

-- ── 2. Which (code, property) pairs are already in use ────────────────────────────────
-- Every reference to a charge code, resolved to the property that owns the referencing
-- row. Used to make sure an outlet's code survives at any property that already uses it.
CREATE TEMP TABLE used_cc AS
  SELECT DISTINCT cc_id, property_id FROM (
    SELECT li."chargeCodeId" AS cc_id, f."propertyId" AS property_id
      FROM "FolioLineItem" li JOIN "Folio" f ON f."id" = li."folioId"
    UNION ALL SELECT pay."chargeCodeId", f."propertyId"
      FROM "Payment" pay JOIN "Folio" f ON f."id" = pay."folioId" WHERE pay."chargeCodeId" IS NOT NULL
    UNION ALL SELECT rr."chargeCodeId", r."propertyId"
      FROM "FolioRoutingRule" rr JOIN "Reservation" r ON r."id" = rr."reservationId"
    UNION ALL SELECT rt."chargeCodeId", r."propertyId"
      FROM "ReservationTransport" rt JOIN "Reservation" r ON r."id" = rt."reservationId" WHERE rt."chargeCodeId" IS NOT NULL
    UNION ALL SELECT occ."chargeCodeId", o."propertyId"
      FROM "OutletChargeCode" occ JOIN "Outlet" o ON o."id" = occ."outletId"
    UNION ALL SELECT a."chargeCodeId", a."propertyId" FROM "Allocation" a
    UNION ALL SELECT rp."chargeCodeId", rp."propertyId" FROM "RatePlan" rp WHERE rp."chargeCodeId" IS NOT NULL
    UNION ALL SELECT et."chargeCodeId", et."propertyId" FROM "ExcursionType" et
    UNION ALL SELECT st."chargeCodeId", st."propertyId" FROM "SpaTreatment" st
    UNION ALL SELECT fr."chargeCodeId", fr."propertyId" FROM "PropertyFeeRule" fr WHERE fr."chargeCodeId" IS NOT NULL
  ) refs;

-- ── 3. Clone maps: (original row, property) → new id ─────────────────────────────────
CREATE TEMP TABLE map_tp AS
  SELECT t."id" AS old_id, p."id" AS property_id, gen_random_uuid()::text AS new_id
  FROM "TaxProfile" t JOIN "Property" p ON p."enterpriseId" = t."enterpriseId";

CREATE TEMP TABLE map_cg AS
  SELECT g."id" AS old_id, p."id" AS property_id, gen_random_uuid()::text AS new_id
  FROM "ChargeGroup" g JOIN "Property" p ON p."enterpriseId" = g."enterpriseId";

-- A shared subgroup goes to every property; an outlet's own subgroup only to the
-- outlet's property — plus any property already using one of its codes.
CREATE TEMP TABLE map_cs AS
  SELECT s."id" AS old_id, p."id" AS property_id, gen_random_uuid()::text AS new_id
  FROM "ChargeSubgroup" s
  JOIN "Property" p ON p."enterpriseId" = s."enterpriseId"
  LEFT JOIN "Outlet" o ON o."id" = s."outletId"
  WHERE s."outletId" IS NULL
     OR o."propertyId" = p."id"
     OR EXISTS (
       SELECT 1 FROM "ChargeCode" c JOIN used_cc u ON u.cc_id = c."id"
       WHERE c."chargeSubgroupId" = s."id" AND u.property_id = p."id"
     );

-- A code goes wherever its subgroup went.
CREATE TEMP TABLE map_cc AS
  SELECT c."id" AS old_id, ms.property_id, gen_random_uuid()::text AS new_id
  FROM "ChargeCode" c JOIN map_cs ms ON ms.old_id = c."chargeSubgroupId";

-- A generate goes to every property that has BOTH of its codes.
CREATE TEMP TABLE map_gen AS
  SELECT gn."id" AS old_id, a.property_id, gen_random_uuid()::text AS new_id
  FROM "ChargeCodeGenerate" gn
  JOIN map_cc a ON a.old_id = gn."generatorCodeId"
  JOIN map_cc b ON b.old_id = gn."generatedCodeId" AND b.property_id = a.property_id;

CREATE TEMP TABLE map_pm AS
  SELECT m."id" AS old_id, p."id" AS property_id, gen_random_uuid()::text AS new_id
  FROM "PaymentMethod" m JOIN "Property" p ON p."enterpriseId" = m."enterpriseId";

-- ── 4. Clones ─────────────────────────────────────────────────────────────────────────
INSERT INTO "TaxProfile" ("id", "enterpriseId", "propertyId", "name", "description")
  SELECT m.new_id, t."enterpriseId", m.property_id, t."name", t."description"
  FROM map_tp m JOIN "TaxProfile" t ON t."id" = m.old_id;

INSERT INTO "TaxRate" ("id", "taxProfileId", "name", "ratePercent", "calculateOn", "order", "effectiveFrom", "effectiveTo")
  SELECT gen_random_uuid()::text, m.new_id, r."name", r."ratePercent", r."calculateOn", r."order", r."effectiveFrom", r."effectiveTo"
  FROM "TaxRate" r JOIN map_tp m ON m.old_id = r."taxProfileId";

INSERT INTO "ChargeGroup" ("id", "enterpriseId", "propertyId", "code", "name", "reportBucket", "isRevenue", "isSystem", "sortOrder")
  SELECT m.new_id, g."enterpriseId", m.property_id, g."code", g."name", g."reportBucket", g."isRevenue", g."isSystem", g."sortOrder"
  FROM map_cg m JOIN "ChargeGroup" g ON g."id" = m.old_id;

INSERT INTO "ChargeSubgroup" ("id", "enterpriseId", "propertyId", "chargeGroupId", "code", "name", "isSystem", "sortOrder", "outletId")
  SELECT m.new_id, s."enterpriseId", m.property_id, mg.new_id, s."code", s."name", s."isSystem", s."sortOrder",
         -- the outlet link stays only on the outlet's own property's copy
         CASE WHEN o."propertyId" = m.property_id THEN s."outletId" ELSE NULL END
  FROM map_cs m
  JOIN "ChargeSubgroup" s ON s."id" = m.old_id
  JOIN map_cg mg ON mg.old_id = s."chargeGroupId" AND mg.property_id = m.property_id
  LEFT JOIN "Outlet" o ON o."id" = s."outletId";

INSERT INTO "ChargeCode" ("id", "enterpriseId", "propertyId", "code", "description", "chargeSubgroupId", "postingType", "isSystem", "isActive", "useDefaultTax", "taxProfileId")
  SELECT m.new_id, c."enterpriseId", m.property_id, c."code", c."description", ms.new_id, c."postingType", c."isSystem", c."isActive", c."useDefaultTax", mt.new_id
  FROM map_cc m
  JOIN "ChargeCode" c ON c."id" = m.old_id
  JOIN map_cs ms ON ms.old_id = c."chargeSubgroupId" AND ms.property_id = m.property_id
  LEFT JOIN map_tp mt ON mt.old_id = c."taxProfileId" AND mt.property_id = m.property_id;

INSERT INTO "ChargeCodeGenerate" ("id", "enterpriseId", "propertyId", "generatorCodeId", "generatedCodeId", "method", "value", "calculateOn", "basisGenerateId", "sortOrder", "isActive")
  SELECT m.new_id, gn."enterpriseId", m.property_id, a.new_id, b.new_id, gn."method", gn."value", gn."calculateOn",
         mb.new_id, gn."sortOrder", gn."isActive"
  FROM map_gen m
  JOIN "ChargeCodeGenerate" gn ON gn."id" = m.old_id
  JOIN map_cc a ON a.old_id = gn."generatorCodeId" AND a.property_id = m.property_id
  JOIN map_cc b ON b.old_id = gn."generatedCodeId" AND b.property_id = m.property_id
  LEFT JOIN map_gen mb ON mb.old_id = gn."basisGenerateId" AND mb.property_id = m.property_id;

INSERT INTO "PaymentMethod" ("id", "enterpriseId", "propertyId", "name", "type", "isActive", "chargeCodeId")
  SELECT m.new_id, pm."enterpriseId", m.property_id, pm."name", pm."type", pm."isActive", mc.new_id
  FROM map_pm m
  JOIN "PaymentMethod" pm ON pm."id" = m.old_id
  LEFT JOIN map_cc mc ON mc.old_id = pm."chargeCodeId" AND mc.property_id = m.property_id;

-- ── 5. Re-point every reference at its own property's clone ──────────────────────────
UPDATE "FolioLineItem" li SET "chargeCodeId" = m.new_id
  FROM "Folio" f, map_cc m
  WHERE f."id" = li."folioId" AND m.old_id = li."chargeCodeId" AND m.property_id = f."propertyId";

UPDATE "Payment" pay SET "chargeCodeId" = m.new_id
  FROM "Folio" f, map_cc m
  WHERE f."id" = pay."folioId" AND m.old_id = pay."chargeCodeId" AND m.property_id = f."propertyId";

UPDATE "Payment" pay SET "paymentMethodId" = m.new_id
  FROM "Folio" f, map_pm m
  WHERE f."id" = pay."folioId" AND m.old_id = pay."paymentMethodId" AND m.property_id = f."propertyId";

UPDATE "Folio" f SET "defaultPaymentMethodId" = m.new_id
  FROM map_pm m
  WHERE m.old_id = f."defaultPaymentMethodId" AND m.property_id = f."propertyId";

UPDATE "FolioRoutingRule" rr SET "chargeCodeId" = m.new_id
  FROM "Reservation" r, map_cc m
  WHERE r."id" = rr."reservationId" AND m.old_id = rr."chargeCodeId" AND m.property_id = r."propertyId";

UPDATE "ReservationTransport" rt SET "chargeCodeId" = m.new_id
  FROM "Reservation" r, map_cc m
  WHERE r."id" = rt."reservationId" AND m.old_id = rt."chargeCodeId" AND m.property_id = r."propertyId";

UPDATE "OutletChargeCode" occ SET "chargeCodeId" = m.new_id
  FROM "Outlet" o, map_cc m
  WHERE o."id" = occ."outletId" AND m.old_id = occ."chargeCodeId" AND m.property_id = o."propertyId";

UPDATE "Outlet" o SET "taxProfileId" = m.new_id
  FROM map_tp m
  WHERE m.old_id = o."taxProfileId" AND m.property_id = o."propertyId";

UPDATE "Allocation" a SET "chargeCodeId" = m.new_id
  FROM map_cc m WHERE m.old_id = a."chargeCodeId" AND m.property_id = a."propertyId";

UPDATE "RatePlan" rp SET "chargeCodeId" = m.new_id
  FROM map_cc m WHERE m.old_id = rp."chargeCodeId" AND m.property_id = rp."propertyId";

UPDATE "ExcursionType" et SET "chargeCodeId" = m.new_id
  FROM map_cc m WHERE m.old_id = et."chargeCodeId" AND m.property_id = et."propertyId";

UPDATE "SpaTreatment" st SET "chargeCodeId" = m.new_id
  FROM map_cc m WHERE m.old_id = st."chargeCodeId" AND m.property_id = st."propertyId";

UPDATE "PropertyFeeRule" fr SET "chargeCodeId" = m.new_id
  FROM map_cc m WHERE m.old_id = fr."chargeCodeId" AND m.property_id = fr."propertyId";

UPDATE "ActivityOnlineSettings" ao SET "onlinePaymentMethodId" = m.new_id
  FROM map_pm m WHERE m.old_id = ao."onlinePaymentMethodId" AND m.property_id = ao."propertyId";

-- ── 6. Enterprise settings → each property's settings ─────────────────────────────────
UPDATE "PropertySettings" ps SET
    "defaultAccommodationChargeCodeId" = (SELECT m.new_id FROM map_cc m WHERE m.old_id = es."defaultAccommodationChargeCodeId" AND m.property_id = ps."propertyId"),
    "defaultGreenTaxChargeCodeId"      = (SELECT m.new_id FROM map_cc m WHERE m.old_id = es."defaultGreenTaxChargeCodeId" AND m.property_id = ps."propertyId"),
    "commissionChargeCodeId"           = (SELECT m.new_id FROM map_cc m WHERE m.old_id = es."commissionChargeCodeId" AND m.property_id = ps."propertyId"),
    "cityLedgerPaymentMethodId"        = (SELECT m.new_id FROM map_pm m WHERE m.old_id = es."cityLedgerPaymentMethodId" AND m.property_id = ps."propertyId"),
    -- A module outlet link only survives on the property that owns the outlet.
    "spaOutletId"       = (SELECT o."id" FROM "Outlet" o WHERE o."id" = es."spaOutletId" AND o."propertyId" = ps."propertyId"),
    "excursionOutletId" = (SELECT o."id" FROM "Outlet" o WHERE o."id" = es."excursionOutletId" AND o."propertyId" = ps."propertyId"),
    "cashierDefaultFloat"  = es."cashierDefaultFloat",
    "exchangeFromCurrency" = es."exchangeFromCurrency",
    "exchangeToCurrency"   = es."exchangeToCurrency",
    "greenTaxEnabled"      = es."greenTaxEnabled",
    "greenTaxAdultAmount"  = es."greenTaxAdultAmount",
    "greenTaxChildAmount"  = es."greenTaxChildAmount",
    "greenTaxStayBasis"    = es."greenTaxStayBasis",
    "greenTaxExemptAge"    = es."greenTaxExemptAge",
    "tgstEnabled"          = es."tgstEnabled",
    "tgstRate"             = es."tgstRate",
    "serviceChargeEnabled" = es."serviceChargeEnabled",
    "serviceChargeRate"    = es."serviceChargeRate"
  FROM "Property" p, "EnterpriseSettings" es
  WHERE p."id" = ps."propertyId" AND es."enterpriseId" = p."enterpriseId";

-- ── 7. Drop the originals (the safety net — see the header) ──────────────────────────
-- A link from an outlet to a code that now only exists at another property is meaningless;
-- the property's own copy was linked above wherever one exists.
DELETE FROM "OutletChargeCode" WHERE "chargeCodeId" IN (SELECT "id" FROM "ChargeCode" WHERE "propertyId" IS NULL);
DELETE FROM "ChargeCodeGenerate" WHERE "propertyId" IS NULL;
DELETE FROM "PaymentMethod" WHERE "propertyId" IS NULL;
DELETE FROM "ChargeCode" WHERE "propertyId" IS NULL;
DELETE FROM "ChargeSubgroup" WHERE "propertyId" IS NULL;
DELETE FROM "ChargeGroup" WHERE "propertyId" IS NULL;
DELETE FROM "TaxProfile" WHERE "propertyId" IS NULL;

-- ── 8. Constraints ────────────────────────────────────────────────────────────────────
ALTER TABLE "ChargeGroup" ALTER COLUMN "propertyId" SET NOT NULL;
ALTER TABLE "ChargeSubgroup" ALTER COLUMN "propertyId" SET NOT NULL;
ALTER TABLE "ChargeCode" ALTER COLUMN "propertyId" SET NOT NULL;
ALTER TABLE "ChargeCodeGenerate" ALTER COLUMN "propertyId" SET NOT NULL;
ALTER TABLE "TaxProfile" ALTER COLUMN "propertyId" SET NOT NULL;
ALTER TABLE "PaymentMethod" ALTER COLUMN "propertyId" SET NOT NULL;

DROP INDEX "ChargeCodeGenerate_enterpriseId_generatorCodeId_idx";
CREATE UNIQUE INDEX "ChargeCode_propertyId_code_key" ON "ChargeCode"("propertyId", "code");
CREATE INDEX "ChargeCodeGenerate_propertyId_generatorCodeId_idx" ON "ChargeCodeGenerate"("propertyId", "generatorCodeId");
CREATE UNIQUE INDEX "ChargeGroup_propertyId_code_key" ON "ChargeGroup"("propertyId", "code");
CREATE UNIQUE INDEX "ChargeSubgroup_propertyId_code_key" ON "ChargeSubgroup"("propertyId", "code");
CREATE INDEX "PaymentMethod_propertyId_idx" ON "PaymentMethod"("propertyId");
CREATE INDEX "TaxProfile_propertyId_idx" ON "TaxProfile"("propertyId");
CREATE INDEX "PropertySettings_spaOutletId_idx" ON "PropertySettings"("spaOutletId");
CREATE INDEX "PropertySettings_excursionOutletId_idx" ON "PropertySettings"("excursionOutletId");

ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChargeGroup" ADD CONSTRAINT "ChargeGroup_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChargeSubgroup" ADD CONSTRAINT "ChargeSubgroup_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChargeCode" ADD CONSTRAINT "ChargeCode_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChargeCodeGenerate" ADD CONSTRAINT "ChargeCodeGenerate_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PropertySettings" ADD CONSTRAINT "PropertySettings_spaOutletId_fkey" FOREIGN KEY ("spaOutletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PropertySettings" ADD CONSTRAINT "PropertySettings_excursionOutletId_fkey" FOREIGN KEY ("excursionOutletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 9. The moved settings leave EnterpriseSettings ────────────────────────────────────
ALTER TABLE "EnterpriseSettings" DROP CONSTRAINT "EnterpriseSettings_excursionOutletId_fkey";
ALTER TABLE "EnterpriseSettings" DROP CONSTRAINT "EnterpriseSettings_spaOutletId_fkey";
DROP INDEX "EnterpriseSettings_excursionOutletId_idx";
DROP INDEX "EnterpriseSettings_spaOutletId_idx";
ALTER TABLE "EnterpriseSettings" DROP COLUMN "cashierDefaultFloat",
DROP COLUMN "cityLedgerPaymentMethodId",
DROP COLUMN "commissionChargeCodeId",
DROP COLUMN "defaultAccommodationChargeCodeId",
DROP COLUMN "defaultGreenTaxChargeCodeId",
DROP COLUMN "exchangeFromCurrency",
DROP COLUMN "exchangeToCurrency",
DROP COLUMN "excursionOutletId",
DROP COLUMN "greenTaxAdultAmount",
DROP COLUMN "greenTaxChildAmount",
DROP COLUMN "greenTaxEnabled",
DROP COLUMN "greenTaxExemptAge",
DROP COLUMN "greenTaxStayBasis",
DROP COLUMN "serviceChargeEnabled",
DROP COLUMN "serviceChargeRate",
DROP COLUMN "spaOutletId",
DROP COLUMN "tgstEnabled",
DROP COLUMN "tgstRate";
