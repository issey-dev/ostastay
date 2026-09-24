import { prisma } from "@/lib/db"
import { amenityNameKey } from "@/lib/facility-amenity"

// Another amenity at the same property already has this name (case-insensitive)?
// Server-only twin of facility-amenity.ts (which the client form also imports).
export async function amenityNameTaken(propertyId: string, name: string, exceptId?: string) {
  const siblings = await prisma.facility.findMany({
    where: { propertyId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true },
  })
  const key = amenityNameKey(name)
  return siblings.some((f) => amenityNameKey(f.name) === key)
}
