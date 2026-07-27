// One-off backfill for the Charge Code hierarchy (CHARGE_CODE_PLAN.md §6), introduced
// alongside migration 20260727051346_charge_code_hierarchy.
//
// For each enterprise it:
//   1. creates the canonical ChargeGroup -> ChargeSubgroup tree,
//   2. creates the system ROOM / GTX / COMM charge codes if missing (closing the
//      provisioning gap for tenants onboarded before the tree existed),
//   3. classifies every existing ChargeCode into a subgroup from its legacy `category`,
//   4. creates the ROOM -> GTX generate row so Green Tax posts from config.
//
// Idempotent — safe to re-run. A code whose `category` doesn't map to a known subgroup
// is REPORTED, never guessed; fix those by hand in Controls > Cashiering and re-run.
//
// Run it through vite-node rather than Node's type-stripping — unlike the other
// dev-tools scripts this one reaches into src/lib, which uses the `@/` path alias:
//
//   npx vite-node -c vitest.config.ts scripts/dev-tools/backfill-charge-hierarchy.ts               # dry run (default)
//   npx vite-node -c vitest.config.ts scripts/dev-tools/backfill-charge-hierarchy.ts -- --apply    # write changes
import { PrismaClient } from "@prisma/client"
import { ensureChargeTree } from "../../src/lib/posting/ensure-charge-tree"

const prisma = new PrismaClient()
const APPLY = process.argv.includes("--apply")

async function main() {
  const enterprises = await prisma.enterprise.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })

  if (enterprises.length === 0) {
    console.log("No enterprises found — nothing to backfill.")
    return
  }

  console.log(`${APPLY ? "Applying to" : "Dry run over"} ${enterprises.length} enterprise${enterprises.length === 1 ? "" : "s"}:\n`)

  let totalUnmapped = 0

  for (const ent of enterprises) {
    // The dry run does the same work inside a transaction that is then rolled back, so
    // the reported counts are exactly what --apply would write.
    const run = async (client: Parameters<typeof ensureChargeTree>[0]) => ensureChargeTree(client, ent.id)

    let result
    if (APPLY) {
      result = await prisma.$transaction((tx) => run(tx), { timeout: 30_000 })
    } else {
      try {
        await prisma.$transaction(async (tx) => {
          result = await run(tx)
          throw new RollbackDryRun()
        }, { timeout: 30_000 })
      } catch (e) {
        if (!(e instanceof RollbackDryRun)) throw e
      }
    }
    if (!result) continue

    const parts = [
      `${result.groupsCreated} group(s)`,
      `${result.subgroupsCreated} subgroup(s)`,
      `${result.codesCreated} system code(s)`,
      `${result.codesClassified} code(s) classified`,
      `${result.generatesCreated} generate(s)`,
    ]
    console.log(`  ${ent.name}`)
    console.log(`    ${parts.join(", ")}`)

    if (result.unmapped.length > 0) {
      totalUnmapped += result.unmapped.length
      console.log(`    ⚠ ${result.unmapped.length} code(s) with an unrecognized category — classify these by hand:`)
      for (const u of result.unmapped) {
        console.log(`        ${u.code.padEnd(10)} category="${u.category}"`)
      }
    }
  }

  if (totalUnmapped > 0) {
    console.log(`\n${totalUnmapped} charge code(s) could not be classified automatically. Assign each a Subgroup in Controls > Cashiering > Charge Codes, then re-run.`)
  }

  if (!APPLY) {
    console.log("\nNo changes written. Re-run with --apply to persist.")
  } else {
    console.log("\nDone.")
  }
}

class RollbackDryRun extends Error {}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
