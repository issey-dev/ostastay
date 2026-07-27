// One-off backfill: give existing Outlets a `code` (introduced 2026-07-27 alongside
// per-outlet sales-check numbering — see migration 20260726191243_outlet_details_and_check_seq).
// Outlets created before that change have code = null and cannot number checks until they
// have one; the API requires a code on the next edit, but this seeds them all at once.
//
// Derives a code from each outlet's name (deriveOutletCodeBase) and dedupes per property,
// respecting any codes already set. Idempotent: outlets that already have a code are left
// untouched, so re-running only fills gaps.
//
// Runs with Node's type-stripping (same as the other dev-tools scripts), loading the
// sqlite URL from .env:
//
//   node --experimental-strip-types --env-file=.env scripts/dev-tools/backfill-outlet-codes.ts          # dry run (default)
//   node --experimental-strip-types --env-file=.env scripts/dev-tools/backfill-outlet-codes.ts --apply  # write changes
import { PrismaClient } from "@prisma/client"
import { deriveOutletCodeBase, nextAvailableOutletCode } from "../../src/lib/outlet-code.ts"

const prisma = new PrismaClient()
const APPLY = process.argv.includes("--apply")

async function main() {
  const outlets = await prisma.outlet.findMany({
    orderBy: [{ propertyId: "asc" }, { createdAt: "asc" }, { name: "asc" }],
    select: { id: true, propertyId: true, name: true, code: true },
  })

  // Seed each property's "taken" set with codes that already exist, so the backfill never
  // collides with a manually-set code.
  const takenByProperty = new Map<string, Set<string>>()
  for (const o of outlets) {
    if (!takenByProperty.has(o.propertyId)) takenByProperty.set(o.propertyId, new Set())
    if (o.code) takenByProperty.get(o.propertyId)!.add(o.code.toUpperCase())
  }

  const plan: { id: string; name: string; propertyId: string; code: string }[] = []
  for (const o of outlets) {
    if (o.code) continue // already has one — leave it
    const taken = takenByProperty.get(o.propertyId)!
    const code = nextAvailableOutletCode(deriveOutletCodeBase(o.name), taken)
    taken.add(code.toUpperCase())
    plan.push({ id: o.id, name: o.name, propertyId: o.propertyId, code })
  }

  if (plan.length === 0) {
    console.log("Every outlet already has a code — nothing to backfill.")
    return
  }

  console.log(`${APPLY ? "Applying" : "Dry run —"} ${plan.length} outlet code${plan.length === 1 ? "" : "s"}:`)
  for (const p of plan) {
    console.log(`  ${p.code.padEnd(8)}  "${p.name}"  (property ${p.propertyId})`)
  }

  if (!APPLY) {
    console.log("\nNo changes written. Re-run with --apply to persist.")
    return
  }

  await prisma.$transaction(plan.map((p) => prisma.outlet.update({ where: { id: p.id }, data: { code: p.code } })))
  console.log(`\nDone — ${plan.length} outlet code${plan.length === 1 ? "" : "s"} written.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
