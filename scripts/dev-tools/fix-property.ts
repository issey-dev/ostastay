import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const sourcePropertyId = '06faddd3-5c85-44b0-91b5-33cdd71943ad' // Test Dive Center
  const targetPropertyId = '00000000-0000-0000-0000-000000000000' // Main Guest House

  // Update Room Types
  await prisma.roomType.updateMany({
    where: { propertyId: sourcePropertyId },
    data: { propertyId: targetPropertyId }
  })

  // Update Rooms
  await prisma.room.updateMany({
    where: { propertyId: sourcePropertyId },
    data: { propertyId: targetPropertyId }
  })

  // Update Rate Plans
  await prisma.ratePlan.updateMany({
    where: { propertyId: sourcePropertyId },
    data: { propertyId: targetPropertyId }
  })

  // Update Reservations
  await prisma.reservation.updateMany({
    where: { propertyId: sourcePropertyId },
    data: { propertyId: targetPropertyId }
  })

  console.log("Successfully migrated rooms and reservations to the default property!")
}

main().catch(console.error).finally(() => prisma.$disconnect())
