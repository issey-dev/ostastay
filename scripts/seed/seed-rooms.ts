import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const propertyId = "f1f46360-2117-4cec-90f1-ba5512b28305" // Rosemary Hotel

  console.log("Creating building...")
  const building = await prisma.building.create({
    data: {
      propertyId,
      name: "Main Tower",
    }
  })

  console.log("Creating floors...")
  const floor1 = await prisma.floor.create({
    data: {
      buildingId: building.id,
      name: "1st Floor",
    }
  })
  const floor2 = await prisma.floor.create({
    data: {
      buildingId: building.id,
      name: "2nd Floor",
    }
  })

  console.log("Creating room types...")
  const deluxeRoomType = await prisma.roomType.create({
    data: {
      propertyId,
      name: "Deluxe King",
      code: "DLX-K",
      maxOccupancy: 2,
    }
  })

  const standardRoomType = await prisma.roomType.create({
    data: {
      propertyId,
      name: "Standard Queen",
      code: "STD-Q",
      maxOccupancy: 2,
    }
  })

  console.log("Creating rooms...")
  // Floor 1
  await prisma.room.createMany({
    data: [
      { propertyId, floorId: floor1.id, roomTypeId: standardRoomType.id, roomNumber: "101", status: "CLEAN" },
      { propertyId, floorId: floor1.id, roomTypeId: standardRoomType.id, roomNumber: "102", status: "DIRTY" },
      { propertyId, floorId: floor1.id, roomTypeId: standardRoomType.id, roomNumber: "103", status: "INSPECTED" },
    ]
  })

  // Floor 2
  await prisma.room.createMany({
    data: [
      { propertyId, floorId: floor2.id, roomTypeId: deluxeRoomType.id, roomNumber: "201", status: "CLEAN" },
      { propertyId, floorId: floor2.id, roomTypeId: deluxeRoomType.id, roomNumber: "202", status: "DIRTY" },
      { propertyId, floorId: floor2.id, roomTypeId: deluxeRoomType.id, roomNumber: "203", status: "OUT_OF_ORDER" },
    ]
  })

  console.log("Seeding complete! You can now see the rooms on the housekeeping dashboard.")
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
