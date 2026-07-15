const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const propertyId = "00000000-0000-0000-0000-000000000000"
  
  // 1. Delete all rooms for this property to start fresh
  await prisma.room.deleteMany({ where: { propertyId } })
  console.log("Cleared existing rooms for Main Guest House.")

  // 2. Make sure we have a Building
  let building = await prisma.building.findFirst({ where: { propertyId } })
  if (!building) {
    building = await prisma.building.create({
      data: { propertyId, name: "Main Building" }
    })
    console.log("Created Main Building.")
  }

  // 3. Make sure we have a Floor for THIS building
  let floor = await prisma.floor.findFirst({ where: { buildingId: building.id } })
  if (!floor) {
    floor = await prisma.floor.create({
      data: { buildingId: building.id, name: "Ground Floor" }
    })
    console.log("Created Ground Floor for Main Building.")
  }

  // 4. Get Room Types
  const roomTypes = await prisma.roomType.findMany({ where: { propertyId } })
  if (!roomTypes.length) {
    console.error("No room types found for this property!")
    return
  }

  // 5. Seed 20 Rooms properly linked
  const rooms = []
  for (let i = 1; i <= 20; i++) {
    const roomNumber = `1${i.toString().padStart(2, '0')}`
    const roomType = roomTypes[i % roomTypes.length]
    const statuses = ["CLEAN", "DIRTY", "INSPECTED", "OUT_OF_ORDER"]
    const status = statuses[Math.floor(Math.random() * statuses.length)]
    
    rooms.push({
      propertyId,
      floorId: floor.id,
      roomTypeId: roomType.id,
      roomNumber,
      status
    })
  }

  let createdCount = 0
  for (const r of rooms) {
    await prisma.room.upsert({
      where: { 
        propertyId_roomNumber: { propertyId, roomNumber: r.roomNumber }
      },
      update: r,
      create: r
    })
    createdCount++
  }

  console.log(`Successfully seeded ${createdCount} properly linked rooms!`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
