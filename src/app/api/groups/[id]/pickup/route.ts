import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { randomBytes } from "crypto"

// Generates an alphanumeric reservation number
const generateReservationNumber = () => {
  return randomBytes(4).toString('hex').toUpperCase()
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const { 
      firstName, 
      lastName, 
      email, 
      phone, 
      roomTypeId, 
      roomId, 
      checkInDate, 
      checkOutDate, 
      adults 
    } = body

    if (!firstName || !lastName || !roomTypeId || !checkInDate || !checkOutDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const group = await prisma.groupBlock.findUnique({
      where: { id },
      include: { property: true }
    })

    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 })

    const ratePlan = await prisma.ratePlan.findFirst({
      where: { propertyId: group.propertyId },
      orderBy: { priority: 'asc' }
    })

    if (!ratePlan) {
      return NextResponse.json({ error: "No rate plan configured for this property" }, { status: 400 })
    }

    // Create the Profile and Reservation inside a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create or Find Profile
      let profile = email
        ? await tx.profile.findFirst({
            where: { enterpriseId: group.property.enterpriseId, contacts: { some: { email } } }
          })
        : null

      if (!profile) {
        profile = await tx.profile.create({
          data: {
            enterpriseId: group.property.enterpriseId,
            profileType: "GUEST",
            firstName,
            lastName,
            contacts: (email || phone) ? {
              create: [{ contactType: "PRIMARY", isPrimary: true, email, mobile: phone }]
            } : undefined
          }
        })
      }

      // 2. Create the Reservation
      const reservation = await tx.reservation.create({
        data: {
          propertyId: group.propertyId,
          confirmationNo: generateReservationNumber(),
          primaryGuestId: profile.upid,
          groupBlockId: id,
          checkInDate: new Date(checkInDate),
          checkOutDate: new Date(checkOutDate),
          adults: parseInt(adults) || 1,
          status: "CONFIRMED"
        }
      })

      // 3. Assign the Room
      await tx.roomAssignment.create({
        data: {
          reservationId: reservation.id,
          roomTypeId,
          roomId: roomId || null,
          ratePlanId: ratePlan.id,
          startDate: new Date(checkInDate),
          endDate: new Date(checkOutDate),
        }
      })

      // 4. Create the Folio for this reservation
      await tx.folio.create({
        data: {
          reservationId: reservation.id
        }
      })

      return reservation
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Error creating group pickup:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
