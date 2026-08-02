import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope"

export async function GET(request: Request) {
  try {
    const ctx = await requireSession()
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get("propertyId")
    // Case-insensitivity comes from `mode: "insensitive"` on the filters below, NOT from
    // this normalisation. Lower-casing alone silently stopped working when the database
    // moved to Postgres (2026-08-02): SQLite's LIKE is case-insensitive for ASCII, so
    // comparing a lower-cased needle against a capitalised name happened to match, while
    // Postgres LIKE is case-sensitive and matched nothing — every guest name has a
    // capital letter, so Fast Post search returned no results at all.
    const query = searchParams.get("query")?.toLowerCase()

    if (!propertyId || !query) {
      return NextResponse.json({ error: "Property ID and search query are required" }, { status: 400 })
    }
    await assertPropertyAccess(ctx, propertyId)

    // Only IN_HOUSE guests can be charged from Fast Post — a reservation that hasn't
    // checked in yet has no billable, open folio to route an outlet charge to. Match on
    // guest name or room number.
    const reservations = await prisma.reservation.findMany({
      where: {
        propertyId,
        status: "IN_HOUSE",
        OR: [
          {
            primaryGuest: {
              OR: [
                { lastName: { contains: query, mode: "insensitive" } },
                { firstName: { contains: query, mode: "insensitive" } }
              ]
            }
          },
          {
            assignments: {
              some: {
                room: {
                  roomNumber: { contains: query, mode: "insensitive" }
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
