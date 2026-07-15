const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const propertyId = "00000000-0000-0000-0000-000000000000"
  const tenantId = "00000000-0000-0000-0000-000000000000"

  // Ensure property exists
  await prisma.property.upsert({
    where: { id: propertyId },
    update: {},
    create: {
      id: propertyId,
      tenantId: tenantId,
      name: "Main Guest House",
      legalName: "Main Guest House LLC",
      code: "MAIN",
      defaultCurrency: "USD",
      timeZone: "UTC",
      checkInTime: "15:00",
      checkOutTime: "11:00"
    }
  })

  // Create Building
  const building = await prisma.building.create({
    data: {
      propertyId,
      name: "Main Building"
    }
  })

  // Create Floor
  const floor = await prisma.floor.create({
    data: {
      buildingId: building.id,
      name: "Ground Floor"
    }
  })

  // Create Room Types
  const existingDlx = await prisma.roomType.findFirst({ where: { propertyId, code: "DLX" } })
  const deluxe = existingDlx || await prisma.roomType.create({
    data: {
      propertyId,
      name: "Deluxe Room",
      code: "DLX",
      basePrice: 150.00,
      maxOccupancy: 2,
    }
  })

  const existingSte = await prisma.roomType.findFirst({ where: { propertyId, code: "STE" } })
  const suite = existingSte || await prisma.roomType.create({
    data: {
      propertyId,
      name: "Executive Suite",
      code: "STE",
      basePrice: 250.00,
      maxOccupancy: 4,
    }
  })

  // Create Rooms
  const rooms = [
    { propertyId, roomTypeId: deluxe.id, roomNumber: "101", status: "CLEAN", floorId: floor.id },
    { propertyId, roomTypeId: deluxe.id, roomNumber: "102", status: "CLEAN", floorId: floor.id },
    { propertyId, roomTypeId: suite.id, roomNumber: "201", status: "CLEAN", floorId: floor.id },
  ]

  for (const r of rooms) {
    await prisma.room.upsert({
      where: { propertyId_roomNumber: { propertyId, roomNumber: r.roomNumber } },
      update: {},
      create: r
    })
  }

  // Create Rate Plans
  const standardRate = await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId, code: "BAR" } },
    update: {},
    create: {
      propertyId,
      name: "Best Available Rate",
      code: "BAR",
      description: "Standard flexible rate",
    }
  })

  const nonRefRate = await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId, code: "NRF" } },
    update: {},
    create: {
      propertyId,
      name: "Non-Refundable",
      code: "NRF",
      description: "Discounted non-refundable rate",
    }
  })

  console.log("Successfully seeded Property, Buildings, Floors, Room Types, Rooms, and Rate Plans!")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
