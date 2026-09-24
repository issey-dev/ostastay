// npm run charges:cleanup-demo            — report what would change, on every property
// npm run charges:cleanup-demo -- --apply — make the changes
// Optional: --enterprise <slug> or --property <id> to limit it.
//
// Removes the demo charge codes older properties were seeded with (owner, 2026-09-24).
// The rules — what is deleted, deactivated or kept — are in src/lib/posting/demo-code-cleanup.ts.
import { prisma } from "../src/lib/db";
import { cleanupDemoChargeCodes } from "../src/lib/posting/demo-code-cleanup";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const only = arg("--property");
const enterpriseSlug = arg("--enterprise");

const properties = await prisma.property.findMany({
  where: { ...(only ? { id: only } : {}), ...(enterpriseSlug ? { enterprise: { slug: enterpriseSlug } } : {}) },
  select: { id: true, name: true, enterprise: { select: { name: true } } },
  orderBy: [{ enterprise: { name: "asc" } }, { name: "asc" }],
});

let deleted = 0, deactivated = 0, kept = 0, subgroups = 0;
for (const p of properties) {
  const r = await cleanupDemoChargeCodes(p.id, { apply });
  if (!r.deleted.length && !r.deactivated.length && !r.kept.length && !r.subgroupsDeleted.length) continue;
  console.log(`\n${p.enterprise.name} › ${p.name} (${p.id})`);
  if (r.deleted.length) console.log(`  delete (${r.deleted.length}): ${r.deleted.join("; ")}`);
  if (r.deactivated.length) console.log(`  deactivate — has postings (${r.deactivated.length}): ${r.deactivated.join("; ")}`);
  for (const k of r.kept) console.log(`  keep — in use: ${k.code} (${k.usedBy.join(", ")})`);
  if (r.subgroupsDeleted.length) console.log(`  empty subgroups deleted: ${r.subgroupsDeleted.join("; ")}`);
  if (r.outletsUnlinked.length) console.log(`  outlets losing their demo codes: ${r.outletsUnlinked.join(", ")}`);
  deleted += r.deleted.length; deactivated += r.deactivated.length; kept += r.kept.length; subgroups += r.subgroupsDeleted.length;
}

console.log(
  `\n${apply ? "Done" : "Dry run (nothing changed — add --apply)"}: ${properties.length} properties; ` +
    `${deleted} deleted, ${deactivated} deactivated, ${kept} kept (in use), ${subgroups} empty subgroups removed.`
);
await prisma.$disconnect();
