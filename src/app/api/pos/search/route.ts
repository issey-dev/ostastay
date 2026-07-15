import { NextResponse } from "next/server"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get("propertyId")
    const query = searchParams.get("query")?.toLowerCase()

    if (!propertyId || !query) {
      return NextResponse.json({ error: "Property ID and search query are required" }, { status: 400 })
    }

    // We search for CONFIRMED or CHECKED_IN reservations
    // where either the room number or guest name matches the query.
    const reservations = await prisma.reservation.findMany({
      where: {
        propertyId,
        status: { in: ["RESERVED", "IN_HOUSE"] },
        OR: [
          {
            primaryGuest: {
              OR: [
                { lastName: { contains: query } },
                { firstName: { contains: query } }
              ]
            }
          },
          {
            assignments: {
              some: {
                room: {
                  roomNumber: { contains: query }
                }
              }
            }
          }
        ]
      },
      include: {
        primaryGuest: true,
        assignments: {
          include: { room: true }
        },
        folios: {
          where: { isClosed: false }
        }
      }
    })

    // Format for the frontend
    const results = reservations.map(res => ({
      reservationId: res.id,
      guestName: `${res.primaryGuest?.firstName} ${res.primaryGuest?.lastName}`,
      roomNumber: res.assignments?.[0]?.room?.roomNumber || "Unassigned",
      status: res.status,
      folioId: res.folios?.[0]?.id
    }))

    return NextResponse.json(results)
  } catch (error) {
    console.error("Error searching POS guests:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
