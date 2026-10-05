import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { handle, opsGate, propertyIdFrom } from "@/lib/transport/http"

// GET /api/transport/reservations?propertyId=&q= — the booking form's reservation picker:
// this property's live reservations by confirmation number, guest name or group code.
// Just what the form needs (dates, pax, group) — TRANSPORTATION create.
export async function GET(request: Request) {
  return handle(async () => {
    const propertyId = propertyIdFrom(request)
    await opsGate(propertyId, "create")
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim()
    const rows = await prisma.reservation.findMany({
      where: {
        propertyId,
        status: { in: ["RESERVED", "IN_HOUSE"] },
        ...(q
          ? {
              OR: [
                { confirmationNo: { contains: q, mode: "insensitive" as const } },
                { primaryGuest: { firstName: { contains: q, mode: "insensitive" as const } } },
                { primaryGuest: { lastName: { contains: q, mode: "insensitive" as const } } },
                { groupBlock: { code: { contains: q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: {
        primaryGuest: { select: { firstName: true, lastName: true, companyName: true } },
        groupBlock: { select: { id: true, code: true, name: true } },
        assignments: { select: { room: { select: { roomNumber: true } } }, orderBy: { startDate: "asc" }, take: 1 },
      },
      orderBy: { checkInDate: "asc" },
      take: 30,
    })
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        confirmationNo: r.confirmationNo,
        guestName: `${r.primaryGuest.firstName} ${r.primaryGuest.lastName ?? ""}`.trim() || r.primaryGuest.companyName,
        checkInDate: r.checkInDate.toISOString().slice(0, 10),
        checkOutDate: r.checkOutDate.toISOString().slice(0, 10),
        status: r.status,
        adults: r.adults,
        children: r.children,
        infants: r.infants,
        groupBlock: r.groupBlock,
        roomNumber: r.assignments[0]?.room?.roomNumber ?? null,
      }))
    )
  })
}
