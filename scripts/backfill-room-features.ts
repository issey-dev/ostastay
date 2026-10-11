// npm run features:backfill            — report what would be added, on every property
// npm run features:backfill -- --apply — add them
// Optional: --enterprise <slug> or --property <id> to limit it.
//
// Gives existing properties the default bed types, room views and amenities new properties
// now start with. Additive only: codes a property already has are never touched.
// The list and rules are in src/lib/properties/default-room-features.ts.
import { prisma } from "../src/lib/db";
import { DEFAULT_ROOM_FEATURES, ensureDefaultRoomFeatures } from "../src/lib/properties/default-room-features";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const only = arg("--property");
const enterpriseSlug = arg("--enterprise");

const properties = await prisma.property.findMany({
  where: { ...(only ? { id: only } : {}), ...(enterpriseSlug ? { enterprise: { slug: enterpriseSlug } } : {}) },
  select: { id: true, name: true, enterpriseId: true, enterprise: { select: { name: true } } },
  orderBy: [{ enterprise: { name: "asc" } }, { name: "asc" }],
});

let total = 0;
for (const p of properties) {
  let added: number;
  if (apply) {
    added = await ensureDefaultRoomFeatures(prisma, { enterpriseId: p.enterpriseId, propertyId: p.id });
  } else {
    const have = await prisma.systemCode.findMany({
      where: { propertyId: p.id, category: { in: ["BED_TYPE", "ROOM_VIEW", "ROOM_AMENITY"] } },
      select: { category: true, code: true },
    });
    const set = new Set(have.map((h) => `${h.category}:${h.code}`));
    added = DEFAULT_ROOM_FEATURES.filter(([c, code]) => !set.has(`${c}:${code}`)).length;
  }
  console.log(`${p.enterprise.name} › ${p.name}: ${added} ${apply ? "added" : "to add"}`);
  total += added;
}

console.log(
  `\n${apply ? "Done" : "Dry run (nothing changed — add --apply)"}: ${properties.length} properties, ${total} room features ${apply ? "added" : "to add"}.`
);
await prisma.$disconnect();
