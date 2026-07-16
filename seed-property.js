const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // Resolve the demo enterprise dynamically rather than a hardcoded id (see
  // src/app/api/auth/seed/route.ts, which creates it by slug "demo").
  const enterprise = await prisma.enterprise.findUnique({ where: { slug: "demo" } })
  if (!enterprise) throw new Error('No "demo" enterprise found — run the seed route first (POST /api/auth/seed)')
  const enterpriseId = enterprise.id

  // Property.code is unique, so it's the natural idempotency key now that Property no
  // longer has a fixed, hardcoded id.
  const property = await prisma.property.upsert({
    where: { code: "MAIN" },
    update: {},
    create: {
      enterpriseId,
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
  let building = await prisma.building.findFirst({ where: { propertyId: property.id } })
  if (!building) {
    building = await prisma.building.create({
      data: {
        propertyId: property.id,
        name: "Main Building"
      }
    })
  }

  // Create Floor
  let floor = await prisma.floor.findFirst({ where: { buildingId: building.id } })
  if (!floor) {
    floor = await prisma.floor.create({
      data: { buildingId: building.id, name: "Ground Floor" }
    })
  }

  // Create Room Types
  const existingDlx = await prisma.roomType.findFirst({ where: { propertyId: property.id, code: "DLX" } })
  const deluxe = existingDlx || await prisma.roomType.create({
    data: {
      propertyId: property.id,
      name: "Deluxe Room",
      code: "DLX",
      basePrice: 150.00,
      maxOccupancy: 2,
    }
  })

  const existingSte = await prisma.roomType.findFirst({ where: { propertyId: property.id, code: "STE" } })
  const suite = existingSte || await prisma.roomType.create({
    data: {
      propertyId: property.id,
      name: "Executive Suite",
      code: "STE",
      basePrice: 250.00,
      maxOccupancy: 4,
    }
  })

  // Create Rooms
  const rooms = [
    { propertyId: property.id, roomTypeId: deluxe.id, roomNumber: "101", status: "CLEAN", floorId: floor.id },
    { propertyId: property.id, roomTypeId: deluxe.id, roomNumber: "102", status: "CLEAN", floorId: floor.id },
    { propertyId: property.id, roomTypeId: suite.id, roomNumber: "201", status: "CLEAN", floorId: floor.id },
  ]

  for (const r of rooms) {
    await prisma.room.upsert({
      where: { propertyId_roomNumber: { propertyId: r.propertyId, roomNumber: r.roomNumber } },
      update: {},
      create: r
    })
  }

  // Create Rate Plans
  const standardRate = await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: property.id, code: "BAR" } },
    update: {},
    create: {
      propertyId: property.id,
      name: "Best Available Rate",
      code: "BAR",
      description: "Standard flexible rate",
    }
  })

  const nonRefRate = await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: property.id, code: "NRF" } },
    update: {},
    create: {
      propertyId: property.id,
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
