import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// The generic room features every property starts with (owner-approved list, 2026-10-11).
// Room features are property-level SystemCode lists (see system-code-scope.ts): each
// property owns its copy and can rename, deactivate or add to it in the Hub afterwards.
//
// [category, code, label] — sortOrder follows the order written here, per category.
type Feature = readonly [category: "BED_TYPE" | "ROOM_VIEW" | "ROOM_AMENITY", code: string, label: string];

export const DEFAULT_ROOM_FEATURES: readonly Feature[] = [
  ["BED_TYPE", "SINGLE", "Single bed"],
  ["BED_TYPE", "TWIN", "Twin beds"],
  ["BED_TYPE", "DOUBLE", "Double bed"],
  ["BED_TYPE", "QUEEN", "Queen bed"],
  ["BED_TYPE", "KING", "King bed"],
  ["BED_TYPE", "SOFA_BED", "Sofa bed"],
  ["BED_TYPE", "BUNK", "Bunk beds"],

  ["ROOM_VIEW", "OCEAN", "Ocean view"],
  ["ROOM_VIEW", "BEACH", "Beach view"],
  ["ROOM_VIEW", "LAGOON", "Lagoon view"],
  ["ROOM_VIEW", "GARDEN", "Garden view"],
  ["ROOM_VIEW", "POOL", "Pool view"],
  ["ROOM_VIEW", "CITY", "City view"],
  ["ROOM_VIEW", "MOUNTAIN", "Mountain view"],
  ["ROOM_VIEW", "NO_VIEW", "Standard / no view"],

  // Climate and comfort
  ["ROOM_AMENITY", "AC", "Air conditioning"],
  ["ROOM_AMENITY", "FAN", "Ceiling fan"],
  ["ROOM_AMENITY", "HEATING", "Heating"],
  // Technology
  ["ROOM_AMENITY", "WIFI", "Wi-Fi"],
  ["ROOM_AMENITY", "TV", "Flat-screen TV"],
  ["ROOM_AMENITY", "SMART_TV", "Smart TV"],
  ["ROOM_AMENITY", "PHONE", "Telephone"],
  ["ROOM_AMENITY", "USB_PORTS", "USB charging ports"],
  ["ROOM_AMENITY", "SAFE", "In-room safe"],
  // Food and drink
  ["ROOM_AMENITY", "MINIBAR", "Minibar"],
  ["ROOM_AMENITY", "FRIDGE", "Refrigerator"],
  ["ROOM_AMENITY", "KETTLE", "Tea / coffee maker"],
  ["ROOM_AMENITY", "COFFEE_MACHINE", "Coffee machine"],
  ["ROOM_AMENITY", "KITCHENETTE", "Kitchenette"],
  // Bathroom
  ["ROOM_AMENITY", "SHOWER", "Shower"],
  ["ROOM_AMENITY", "BATHTUB", "Bathtub"],
  ["ROOM_AMENITY", "RAIN_SHOWER", "Rain shower"],
  ["ROOM_AMENITY", "HAIRDRYER", "Hairdryer"],
  ["ROOM_AMENITY", "TOILETRIES", "Toiletries"],
  ["ROOM_AMENITY", "BATHROBE", "Bathrobe and slippers"],
  // Space and outdoors
  ["ROOM_AMENITY", "BALCONY", "Balcony"],
  ["ROOM_AMENITY", "TERRACE", "Private terrace"],
  ["ROOM_AMENITY", "PRIVATE_POOL", "Private pool"],
  ["ROOM_AMENITY", "PLUNGE_POOL", "Plunge pool"],
  ["ROOM_AMENITY", "SEATING", "Seating area"],
  ["ROOM_AMENITY", "DESK", "Work desk"],
  // Practical
  ["ROOM_AMENITY", "IRON", "Iron and board"],
  ["ROOM_AMENITY", "WARDROBE", "Wardrobe"],
  ["ROOM_AMENITY", "BLACKOUT", "Blackout curtains"],
  ["ROOM_AMENITY", "SOUNDPROOF", "Soundproofing"],
  ["ROOM_AMENITY", "ACCESSIBLE", "Accessible room"],
  ["ROOM_AMENITY", "CONNECTING", "Connecting room"],
  ["ROOM_AMENITY", "NON_SMOKING", "Non-smoking"],
];

type Client = Prisma.TransactionClient | typeof prisma;

/**
 * Give a property the default room features. Additive and safe to re-run: a (category,
 * code) the property already has — active or not, renamed or not — is left exactly as it
 * is, so a property's own edits and any rooms already pointing at a code are never touched.
 * New rows sort after whatever the property already has in that category.
 * Returns how many were created.
 */
export async function ensureDefaultRoomFeatures(
  client: Client,
  { enterpriseId, propertyId }: { enterpriseId: string; propertyId: string },
): Promise<number> {
  const existing = await client.systemCode.findMany({
    where: { propertyId, category: { in: ["BED_TYPE", "ROOM_VIEW", "ROOM_AMENITY"] } },
    select: { category: true, code: true, sortOrder: true },
  });
  const have = new Set(existing.map((e) => `${e.category}:${e.code}`));
  const nextSort = new Map<string, number>();
  for (const e of existing) nextSort.set(e.category, Math.max(nextSort.get(e.category) ?? 0, e.sortOrder + 1));

  const data: Prisma.SystemCodeCreateManyInput[] = [];
  for (const [category, code, value] of DEFAULT_ROOM_FEATURES) {
    if (have.has(`${category}:${code}`)) continue;
    const sortOrder = nextSort.get(category) ?? 0;
    nextSort.set(category, sortOrder + 1);
    data.push({ enterpriseId, propertyId, category, code, value, sortOrder });
  }
  if (data.length === 0) return 0;
  const result = await client.systemCode.createMany({ data });
  return result.count;
}
