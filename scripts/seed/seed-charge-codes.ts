// Clean-slate chart of accounts.
//
// Wipes an enterprise's charge groups, subgroups, charge codes and generates, then
// rebuilds the canonical chart from src/lib/posting/charge-tree.ts — the same definition
// property onboarding uses, so a seeded database and a freshly onboarded one are
// identical. Also wires the Deposit / Cancellation / No-Show fee rules to their codes.
//
//   npx vite-node -c vitest.config.ts scripts/seed/seed-charge-codes.ts                    # dry run, all enterprises
//   npx vite-node -c vitest.config.ts scripts/seed/seed-charge-codes.ts -- --apply
//   npx vite-node -c vitest.config.ts scripts/seed/seed-charge-codes.ts -- --apply --enterprise=veyo
//   npx vite-node -c vitest.config.ts scripts/seed/seed-charge-codes.ts -- --apply --force  # also delete posted lines
//
// SAFETY: a charge code with folio line items posted against it is billing history. The
// script refuses to wipe those unless --force is given, and tells you exactly how many
// lines --force would delete. Everything else (rate plans, allocations, outlets, fee
// rules, spa treatments, excursion types, transport legs) is detached, not deleted — the
// rebuild then repoints what it can by code.
import { PrismaClient, Prisma } from "@prisma/client"
import { ensureChargeTree, ensureFeeRules } from "../../src/lib/posting/ensure-charge-tree"
import { STANDARD_CHARGE_CODES, CANONICAL_GROUPS, standardGenerates } from "../../src/lib/posting/charge-tree"

const prisma = new PrismaClient()
const APPLY = process.argv.includes("--apply")
const FORCE = process.argv.includes("--force")
const SLUG = process.argv.find((a) => a.startsWith("--enterprise="))?.split("=")[1]

type Tx = Prisma.TransactionClient

const STANDARD_CODES = new Set(STANDARD_CHARGE_CODES.map((c) => c.code))

// Where a config row pointing at a retired code gets repointed. Allocation, SpaTreatment
// and ExcursionType carry a REQUIRED chargeCodeId, so they can't simply be detached —
// each has to land on a real code in the new chart.
const ALLOCATION_CODE_BY_TYPE: Record<string, string> = {
  FNB: "2901", // Meal Plan — Breakfast
  TRANSFER: "5001", // Airport Transfer
  SPA: "3001", // Spa Treatments
  EXCURSION: "4001", // Excursion Tours
}

/**
 * Repoint every configuration reference onto the new chart, by meaning rather than by
 * name. Runs AFTER the chart is built and BEFORE the retired codes are dropped, so no
 * required FK is ever left dangling.
 */
async function repointConfig(tx: Tx, enterpriseId: string, retiredIds: string[]) {
  const codes = await tx.chargeCode.findMany({ where: { enterpriseId }, select: { id: true, code: true } })
  const id = (code: string) => codes.find((c) => c.code === code)?.id ?? null
  const retired = { chargeCodeId: { in: retiredIds } }

  const properties = await tx.property.findMany({ where: { enterpriseId }, select: { id: true } })
  const propertyIds = properties.map((p) => p.id)

  const counts = { ratePlans: 0, allocations: 0, spa: 0, excursions: 0, transport: 0, outletPool: 0, routing: 0 }
  if (propertyIds.length === 0) return counts

  // Rate plans: nullable, so a retired code is simply cleared — Night Audit then falls
  // back to the enterprise's role-resolved accommodation code, which is correct.
  counts.ratePlans = (await tx.ratePlan.updateMany({
    where: { propertyId: { in: propertyIds }, ...retired },
    data: { chargeCodeId: null },
  })).count

  // Allocations post per-component revenue — a breakfast allocation belongs on meal-plan
  // revenue, a transfer on transport. That attribution is the whole point of the model,
  // so match on what the allocation actually sells.
  for (const [type, code] of Object.entries(ALLOCATION_CODE_BY_TYPE)) {
    const target = id(code)
    if (!target) continue
    counts.allocations += (await tx.allocation.updateMany({
      where: { propertyId: { in: propertyIds }, type, ...retired },
      data: { chargeCodeId: target },
    })).count
  }
  // Named meal allocations get their own specific code where the name makes it obvious.
  for (const [needle, code] of [["lunch", "2902"], ["dinner", "2903"]] as const) {
    const target = id(code)
    if (!target) continue
    const rows = await tx.allocation.findMany({
      where: { propertyId: { in: propertyIds }, type: "FNB" },
      select: { id: true, name: true },
    })
    for (const row of rows.filter((x) => x.name.toLowerCase().includes(needle))) {
      await tx.allocation.update({ where: { id: row.id }, data: { chargeCodeId: target } })
    }
  }
  // Anything still on a retired code falls back to Miscellaneous rather than blocking
  // the wipe — visible in Controls, and never a dangling FK.
  const misc = id("6002")
  if (misc) {
    counts.allocations += (await tx.allocation.updateMany({
      where: { propertyId: { in: propertyIds }, ...retired },
      data: { chargeCodeId: misc },
    })).count
  }

  const spaTarget = id("3001")
  if (spaTarget) {
    counts.spa = (await tx.spaTreatment.updateMany({
      where: { propertyId: { in: propertyIds }, ...retired },
      data: { chargeCodeId: spaTarget },
    })).count
  }
  const excTarget = id("4001")
  if (excTarget) {
    counts.excursions = (await tx.excursionType.updateMany({
      where: { propertyId: { in: propertyIds }, ...retired },
      data: { chargeCodeId: excTarget },
    })).count
  }

  // Transport legs: nullable. Point hotel-booked legs at the transfer code.
  counts.transport = (await tx.reservationTransport.updateMany({
    where: { reservation: { propertyId: { in: propertyIds } }, ...retired },
    data: { chargeCodeId: id("5001") },
  })).count

  // An outlet's curated pool and any standing routing rules are pure config —
  // rebuildable from the UI, and meaningless once the codes behind them are gone.
  counts.outletPool = (await tx.outletChargeCode.deleteMany({ where: retired })).count
  counts.routing = (await tx.folioRoutingRule.deleteMany({ where: retired })).count

  return counts
}

/** Drop retired codes plus any subgroup/group left outside the canonical chart. */
async function dropRetired(tx: Tx, enterpriseId: string, retiredIds: string[], force: boolean) {
  let postingsDeleted = 0
  if (retiredIds.length > 0) {
    const inRetired = { chargeCodeId: { in: retiredIds } }
    const postings = await tx.folioLineItem.count({ where: inRetired })
    if (postings > 0) {
      if (!force) throw new Error(`${postings} posted folio line(s) still reference retired codes`)
      // Clear the self-relation and the transport back-reference first, so deletion
      // order can't trip a FK.
      await tx.folioLineItem.updateMany({ where: inRetired, data: { generatedFromLineItemId: null } })
      const doomed = await tx.folioLineItem.findMany({ where: inRetired, select: { id: true } })
      await tx.reservationTransport.updateMany({
        where: { chargedLineItemId: { in: doomed.map((d) => d.id) } },
        data: { chargedLineItemId: null },
      })
      await tx.folioLineItem.deleteMany({ where: inRetired })
      postingsDeleted = postings
    }
    // ChargeCodeGenerate cascades on either side, so retired generates go with them.
    await tx.chargeCode.deleteMany({ where: { id: { in: retiredIds } } })
  }

  const canonicalSubgroups = new Set(CANONICAL_GROUPS.flatMap((g) => g.subgroups.map((s) => s.code)))
  const canonicalGroups = new Set(CANONICAL_GROUPS.map((g) => g.code))
  // Outlet-owned nnRV subgroups (ChargeSubgroup.outletId) are legitimate chart members
  // outside the canonical seed — provisioned per outlet, never dropped here.
  const subgroupsDropped = (await tx.chargeSubgroup.deleteMany({
    where: { enterpriseId, code: { notIn: [...canonicalSubgroups] }, outletId: null, chargeCodes: { none: {} } },
  })).count
  const groupsDropped = (await tx.chargeGroup.deleteMany({
    where: { enterpriseId, code: { notIn: [...canonicalGroups] }, subgroups: { none: {} } },
  })).count

  return { postingsDeleted, subgroupsDropped, groupsDropped }
}

async function main() {
  const enterprises = await prisma.enterprise.findMany({
    where: SLUG ? { slug: SLUG } : {},
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  })

  if (enterprises.length === 0) {
    console.log(SLUG ? `No enterprise with slug "${SLUG}".` : "No enterprises found.")
    return
  }

  const gens = standardGenerates()
  console.log(
    `Chart of accounts: ${CANONICAL_GROUPS.length} groups, ` +
    `${CANONICAL_GROUPS.reduce((n, g) => n + g.subgroups.length, 0)} subgroups, ` +
    `${STANDARD_CHARGE_CODES.length} charge codes, ${gens.length} generates.\n`
  )
  console.log(`${APPLY ? "Applying to" : "Dry run over"} ${enterprises.length} enterprise(s):\n`)

  for (const ent of enterprises) {
    const existing = await prisma.chargeCode.findMany({
      where: { enterpriseId: ent.id },
      select: { id: true, code: true, chargeSubgroup: { select: { outletId: true } } },
    })
    // A code living in an outlet-owned nnRV subgroup is part of the standard by
    // construction (provisioned per outlet) — never retired by the canonical wipe.
    const retired = existing.filter((c) => !STANDARD_CODES.has(c.code) && !c.chargeSubgroup.outletId)
    const retiredPostings = retired.length
      ? await prisma.folioLineItem.count({ where: { chargeCodeId: { in: retired.map((c) => c.id) } } })
      : 0

    console.log(`  ${ent.name} (${ent.slug})`)
    console.log(`    existing: ${existing.length} charge code(s) — ${retired.length} not in the chart, holding ${retiredPostings} posted line(s)`)
    if (retired.length) console.log(`    retiring: ${retired.map((c) => c.code).join(", ")}`)

    if (retiredPostings > 0 && !FORCE) {
      console.log(`    ⚠ SKIPPED — dropping those codes would delete ${retiredPostings} posted folio line(s), which is billing history.`)
      console.log(`      Re-run with --force if this is a dev/demo database you want reset.`)
      continue
    }
    if (!APPLY) {
      console.log(`    would rebuild the chart${retiredPostings > 0 ? `, deleting ${retiredPostings} posted line(s)` : ""}`)
      continue
    }

    // Build the chart FIRST, repoint config onto it, and only then drop what's left
    // over. Allocation / SpaTreatment / ExcursionType carry a required chargeCodeId, so
    // a wipe-then-rebuild would strand them — this order never leaves a dangling FK.
    const summary = await prisma.$transaction(async (tx) => {
      const tree = await ensureChargeTree(tx, ent.id)
      const feeRules = await ensureFeeRules(tx, ent.id)
      const repointed = await repointConfig(tx, ent.id, retired.map((c) => c.id))
      const dropped = await dropRetired(tx, ent.id, retired.map((c) => c.id), FORCE)
      return { tree, feeRules, repointed, dropped }
    }, { timeout: 120_000 })

    console.log(
      `    chart: ${summary.tree.groupsCreated} group(s), ${summary.tree.subgroupsCreated} subgroup(s), ` +
      `${summary.tree.codesCreated} code(s), ${summary.tree.generatesCreated} generate(s) created`
    )
    console.log(`    fee rules: ${summary.feeRules} created (Deposit / Cancellation / No-Show, linked, inactive at 0)`)
    console.log(
      `    repointed: ${summary.repointed.ratePlans} rate plan(s), ${summary.repointed.allocations} allocation(s), ` +
      `${summary.repointed.spa} spa treatment(s), ${summary.repointed.excursions} excursion type(s), ` +
      `${summary.repointed.transport} transport leg(s)`
    )
    console.log(
      `    dropped: ${retired.length} code(s), ${summary.dropped.subgroupsDropped} subgroup(s), ` +
      `${summary.dropped.groupsDropped} group(s)` +
      (summary.dropped.postingsDeleted > 0 ? `, ${summary.dropped.postingsDeleted} posted line(s)` : "")
    )
  }

  if (!APPLY) {
    console.log("\nNo changes written. Re-run with --apply to persist.")
  } else {
    console.log("\nDone. Review Controls > Cashiering, and set fee-rule amounts in Controls > Finance.")
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
