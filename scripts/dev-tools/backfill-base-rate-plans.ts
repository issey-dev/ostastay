// HISTORICAL — already run once during the Base Rate Plan rollout (see
// DECISIONS.md "Base Rate Plan"), kept only as a record of what that one-time
// backfill did. It can no longer function: it had to run between migration
// 20260719160000_rate_plan_locked (adds RatePlan.isLocked) and
// 20260719170000_remove_room_type_base_price (drops RoomType.basePrice) — the only
// window where both columns existed so the old flat default could be carried
// forward into a PriceCalendar row instead of silently lost. `basePrice` is gone
// from the schema now, hence the `as any` below (always undefined if this were
// ever re-run against the current schema).
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const properties = await prisma.property.findMany({ include: { roomTypes: true } })
  const today = new Date()
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  for (const property of properties) {
    let base = await prisma.ratePlan.findFirst({ where: { propertyId: property.id, code: "BASE" } })
    if (!base) {
      base = await prisma.ratePlan.create({
        data: { propertyId: property.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true },
      })
      console.log(`Created Base Rate plan for property "${property.name}"`)
    } else if (!base.isLocked) {
      base = await prisma.ratePlan.update({ where: { id: base.id }, data: { isLocked: true } })
    }

    for (const rt of property.roomTypes) {
      await prisma.priceCalendar.upsert({
        where: { ratePlanId_roomTypeId_date: { ratePlanId: base.id, roomTypeId: rt.id, date: todayMidnight } },
        update: {},
        create: { ratePlanId: base.id, roomTypeId: rt.id, date: todayMidnight, price: (rt as any).basePrice ?? 0 },
      })
    }
    console.log(`Backfilled ${property.roomTypes.length} room type price(s) for "${property.name}"`)
  }

  console.log("Base Rate Plan backfill complete.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
