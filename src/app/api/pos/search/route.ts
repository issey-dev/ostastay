import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope"

export async function GET(request: Request) {
  try {
    const ctx = await requireSession()
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get("propertyId")
    const query = searchParams.get("query")?.toLowerCase()

    if (!propertyId || !query) {
      return NextResponse.json({ error: "Property ID and search query are required" }, { status: 400 })
    }
    await assertPropertyAccess(ctx, propertyId)

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
        },
        accompanyingGuests: {
          include: { profile: true }
        }
      }
    })

    // Format for the frontend. accompanyingGuests surfaces a room's OTHER named
    // guests (a real Profile via AccompanyingGuest, not just a headcount) — added so
    // multi-participant bookings (Spa couple's treatments, etc.) can offer "also in
    // this room" picks instead of only ever finding the primary guest again on a
    // second search.
    const results = reservations.map(res => ({
      reservationId: res.id,
      guestName: `${res.primaryGuest?.firstName} ${res.primaryGuest?.lastName}`,
      roomNumber: res.assignments?.[0]?.room?.roomNumber || "Unassigned",
      status: res.status,
      folioId: res.folios?.[0]?.id,
      profileId: res.primaryGuest?.upid,
      accompanyingGuests: res.accompanyingGuests.map(ag => ({
        upid: ag.profile.upid,
        guestName: `${ag.profile.firstName} ${ag.profile.lastName ?? ""}`.trim(),
      })),
    }))

    return NextResponse.json(results)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
