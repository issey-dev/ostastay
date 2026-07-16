const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // Resolve the property by its code (set in seed-property.js) rather than a hardcoded id.
  const property = await prisma.property.findUnique({ where: { code: "MAIN" } })
  if (!property) {
    console.error("No property with code MAIN found. Please run seed-property.js first.")
    return
  }
  const propertyId = property.id

  // Get required related data
  const profiles = await prisma.profile.findMany()
  const roomTypes = await prisma.roomType.findMany({ where: { propertyId } })
  const ratePlans = await prisma.ratePlan.findMany({ where: { propertyId } })
  const rooms = await prisma.room.findMany({ where: { propertyId } })
  
  if (!profiles.length || !roomTypes.length || !ratePlans.length) {
    console.error("Missing required Profiles, RoomTypes, or RatePlans. Please run other seeders first.")
    return
  }

  const getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)]
  const statuses = ["RESERVED", "IN_HOUSE", "CHECKED_OUT", "NO_SHOW", "CANCELLED"]

  const reservations = []
  
  // We'll generate 10 random reservations
  for (let i = 1; i <= 10; i++) {
    // Generate random start date between 30 days ago and 30 days from now
    const checkInDate = new Date()
    checkInDate.setDate(checkInDate.getDate() + (Math.floor(Math.random() * 60) - 30))
    
    // Generate checkout date 1-5 days after check-in
    const checkOutDate = new Date(checkInDate)
    checkOutDate.setDate(checkInDate.getDate() + Math.floor(Math.random() * 5) + 1)
    
    const rt = getRandomItem(roomTypes)
    const availableRooms = rooms.filter(r => r.roomTypeId === rt.id)
    const isAssigned = Math.random() > 0.3 // 70% chance to have a room assigned
    
    const reservationData = {
      confirmationNo: `RES-20${i.toString().padStart(2, '0')}`, // RES-2001, RES-2002, etc
      propertyId,
      primaryGuestId: getRandomItem(profiles).upid,
      checkInDate,
      checkOutDate,
      adults: Math.floor(Math.random() * 2) + 1, // 1-2 adults
      children: Math.floor(Math.random() * 3),   // 0-2 children
      status: getRandomItem(statuses),
      assignments: {
        create: [
          {
            roomTypeId: rt.id,
            roomId: isAssigned && availableRooms.length > 0 ? getRandomItem(availableRooms).id : null,
            ratePlanId: getRandomItem(ratePlans).id,
            startDate: checkInDate,
            endDate: checkOutDate
          }
        ]
      }
    }

    reservations.push(reservationData)
  }

  await prisma.payment.deleteMany()
  await prisma.folioLineItem.deleteMany()
  await prisma.folio.deleteMany()
  await prisma.reservationTrace.deleteMany()
  await prisma.accompanyingGuest.deleteMany()
  await prisma.roomAssignment.deleteMany()
  await prisma.reservation.deleteMany()

  for (const r of reservations) {
    await prisma.reservation.create({
      data: r
    })
  }

  console.log(`Successfully seeded ${reservations.length} new reservations!`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
