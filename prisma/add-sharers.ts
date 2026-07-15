import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const propertyId = '00000000-0000-0000-0000-000000000000'
  
  const inHouseReservations = await prisma.reservation.findMany({
    where: { propertyId, status: 'IN_HOUSE' },
    include: { folios: true }
  })
  
  if (inHouseReservations.length === 0) {
    console.log("No in-house reservations found.")
    return
  }
  
  // Find a few profiles to act as sharers
  const allProfiles = await prisma.profile.findMany({
    where: { profileType: 'GUEST' },
    take: 10
  })

  let profileIndex = 5 // Start from 5 so we don't pick the ones already used as primary guests

  for (const res of inHouseReservations) {
    const sharerProfile = allProfiles[profileIndex]
    profileIndex++

    // Add Accompanying Guest (Sharer)
    await prisma.accompanyingGuest.create({
      data: {
        reservationId: res.id,
        profileId: sharerProfile.upid
      }
    })

    // Increment adult count
    await prisma.reservation.update({
      where: { id: res.id },
      data: { adults: 2 }
    })

    // Create Folio 2 for the sharer so they can test moving charges
    const hasFolio2 = res.folios.some(f => f.folioNumber === 2)
    if (!hasFolio2) {
      await prisma.folio.create({
        data: {
          reservationId: res.id,
          folioNumber: 2
        }
      })
    }
    
    console.log(`Added sharer ${sharerProfile.firstName} and Folio 2 to Reservation ${res.confirmationNo}`)
  }

  console.log("Successfully added sharers and Folio 2 to the IN_HOUSE reservations!")
}

main().catch(console.error).finally(() => prisma.$disconnect())
