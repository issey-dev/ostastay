// READ-ONLY check of the folio check numbers (8.4.0 migration
// 20260926090000_folio_line_check_no) — confirms the backfill did what it should on real
// data. Locally: `npm run checkno:verify`. On the server (compiled into the image, like
// bootstrap-admin):
//
//   docker compose exec app node dist-scripts/scripts/checkno-verify.js
//
// Per property it reports: lines without a number, generated lines (SC / GST / levies) whose
// number differs from their parent's, one number used on several folios, room nights whose
// Green Tax did not join the room's number, and the CHECK_NO counter against the highest
// number issued. Exits 1 when anything needs a look, 0 when clean. Changes nothing.
// Its own PrismaClient, no app imports: the runtime image runs this as plain node
// (tsconfig.scripts.json), where the app's "@/" modules are not available.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

async function main() {
  const started = Date.now();
  const properties = await prisma.property.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  let problems = 0;

  for (const p of properties) {
    const [totals] = await prisma.$queryRaw<Row[]>`
      SELECT COUNT(*) AS lines,
             COUNT(*) FILTER (WHERE l."checkNo" IS NULL) AS missing,
             COUNT(DISTINCT (l."folioId", l."checkNo")) FILTER (WHERE l."checkNo" IS NOT NULL) AS groups
      FROM "FolioLineItem" l JOIN "Folio" f ON f."id" = l."folioId"
      WHERE f."propertyId" = ${p.id}`;

    const [mismatch] = await prisma.$queryRaw<Row[]>`
      SELECT COUNT(*) AS count
      FROM "FolioLineItem" c
      JOIN "FolioLineItem" parent ON parent."id" = c."generatedFromLineItemId"
      JOIN "Folio" f ON f."id" = c."folioId"
      WHERE f."propertyId" = ${p.id} AND c."checkNo" IS DISTINCT FROM parent."checkNo"`;

    // A number on several folios is expected only for routed tax (a generated line routed to
    // another window keeps its parent's number). Root lines sharing a number across folios
    // mean two stays were numbered alike.
    const [crossFolio] = await prisma.$queryRaw<Row[]>`
      SELECT COUNT(*) AS count FROM (
        SELECT l."checkNo"
        FROM "FolioLineItem" l JOIN "Folio" f ON f."id" = l."folioId"
        WHERE f."propertyId" = ${p.id} AND l."checkNo" IS NOT NULL AND l."generatedFromLineItemId" IS NULL
        GROUP BY l."checkNo" HAVING COUNT(DISTINCT l."folioId") > 1
      ) x`;

    // Room nights whose separately posted levy (Green Tax) sits under another number.
    const [splitNights] = await prisma.$queryRaw<Row[]>`
      SELECT COUNT(*) AS count FROM (
        SELECT l."folioId", l."date"
        FROM "FolioLineItem" l
        JOIN "Folio" f ON f."id" = l."folioId"
        JOIN "ChargeCode" cc ON cc."id" = l."chargeCodeId"
        LEFT JOIN "ChargeSubgroup" sg ON sg."id" = cc."chargeSubgroupId"
        LEFT JOIN "ChargeGroup" g ON g."id" = sg."chargeGroupId"
        WHERE f."propertyId" = ${p.id} AND l."generatedFromLineItemId" IS NULL AND l."isVoid" = false
          AND (l."roomAssignmentId" IS NOT NULL OR g."reportBucket" = 'ROOM' OR cc."postingType" = 'TAX')
        GROUP BY l."folioId", l."date"
        HAVING COUNT(*) FILTER (WHERE l."roomAssignmentId" IS NOT NULL OR g."reportBucket" = 'ROOM') > 0
           AND COUNT(DISTINCT l."checkNo") > 1
      ) x`;

    const [maxIssued] = await prisma.$queryRaw<Row[]>`
      SELECT MAX(CAST(l."checkNo" AS BIGINT)) AS max
      FROM "FolioLineItem" l JOIN "Folio" f ON f."id" = l."folioId"
      WHERE f."propertyId" = ${p.id} AND l."checkNo" ~ '^[0-9]{1,15}$'`;
    const counter = await prisma.propertySequence.findUnique({
      where: { propertyId_sequenceType: { propertyId: p.id, sequenceType: "CHECK_NO" } },
      select: { currentValue: true },
    });

    const lines = n(totals.lines);
    const issues: string[] = [];
    if (n(totals.missing) > 0) issues.push(`${n(totals.missing)} line(s) without a check number`);
    if (n(mismatch.count) > 0) issues.push(`${n(mismatch.count)} tax/levy line(s) numbered differently from their charge`);
    if (n(crossFolio.count) > 0) issues.push(`${n(crossFolio.count)} number(s) used on more than one folio`);
    if (n(splitNights.count) > 0) issues.push(`${n(splitNights.count)} room night(s) split over several numbers (review — may be intentional edits)`);
    if (lines > 0 && (counter?.currentValue ?? 0) < n(maxIssued.max)) {
      issues.push(`CHECK_NO counter ${counter?.currentValue ?? "missing"} is below the highest issued ${n(maxIssued.max)}`);
    }

    const head = `${p.code.padEnd(14)} ${String(lines).padStart(7)} lines  ${String(n(totals.groups)).padStart(6)} checks  counter ${counter?.currentValue ?? "—"}`;
    if (issues.length === 0) {
      console.log(`OK   ${head}`);
    } else {
      problems += issues.length;
      console.log(`LOOK ${head}`);
      for (const i of issues) console.log(`       - ${i}`);
    }
  }

  console.log(`\n${properties.length} properties checked in ${((Date.now() - started) / 1000).toFixed(1)}s — ${problems === 0 ? "no problems" : `${problems} item(s) to review`}.`);
  process.exitCode = problems === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
