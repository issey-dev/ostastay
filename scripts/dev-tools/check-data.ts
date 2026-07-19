import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const propertyCount = await prisma.property.count()
  const roomTypeCount = await prisma.roomType.count()
  const roomCount = await prisma.room.count()
  const chargeCodeCount = await prisma.chargeCode.count()
  const profileCount = await prisma.profile.count()
  
  console.log({ propertyCount, roomTypeCount, roomCount, chargeCodeCount, profileCount })

  const property = await prisma.property.findFirst({
    where: { rooms: { some: {} } },
    include: { rooms: true, roomTypes: true, ratePlans: true }
  })
  if (property) {
    console.log("Found Property:", property.name, "Rooms:", property.rooms.length, "RoomTypes:", property.roomTypes.length, "RatePlans:", property.ratePlans.length)
  } else {
    console.log("No property with rooms found!")
  }
  
  const chargeCodes = await prisma.chargeCode.findMany()
  console.log("Charge Codes:", chargeCodes.map(c => c.code))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
