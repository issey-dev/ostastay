const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // Resolve the property by its code (set in seed-property.js) rather than a hardcoded id.
  const property = await prisma.property.findUnique({ where: { code: "MAIN" } })
  const propertyId = property?.id
  const buildings = property ? await prisma.building.findMany({ where: { propertyId } }) : []
  
  if (!property || !buildings.length) {
    console.error("Missing required Property or Buildings. Please run seed-property.js first.")
    return
  }

  const floors = await prisma.floor.findMany()
  const roomTypes = await prisma.roomType.findMany({ where: { propertyId } })
  
  if (!floors.length || !roomTypes.length) {
    console.error(`Missing required Floors or RoomTypes. (Floors: ${floors.length}, RoomTypes: ${roomTypes.length}). Please run seed-property.js first.`)
    return
  }

  const floor = floors[0]
  // Instead of using buildings[0], use the building that owns this floor
  const building = await prisma.building.findUnique({ where: { id: floor.buildingId } })
  
  console.log(`Generating 20 rooms for Building: ${building.name}, Floor: ${floor.name || 'Floor'}`)

  const rooms = []
  
  // We'll generate 20 rooms (101 to 120)
  for (let i = 1; i <= 20; i++) {
    const roomNumber = `1${i.toString().padStart(2, '0')}` // 101, 102 ... 120
    
    // Evenly distribute room types
    const roomType = roomTypes[i % roomTypes.length]
    
    // Random status
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
    try {
      await prisma.room.upsert({
        where: { 
          propertyId_roomNumber: {
            propertyId: r.propertyId,
            roomNumber: r.roomNumber
          }
        },
        update: r,
        create: r
      })
      createdCount++
    } catch (err) {
      console.error(`Failed to create room ${r.roomNumber}:`, err.message)
    }
  }

  console.log(`Successfully seeded ${createdCount} rooms!`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
