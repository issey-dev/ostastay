import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, hasPermission, toErrorResponse } from "@/lib/scope";

// GET /api/search?propertyId=…&q=… — the command palette's search (Ctrl+K, DESKTOP_PLAN §3.9).
// Returns a few of each kind the user may open: reservations (conf #, external ref, guest or
// accompanying guest name) of this property, guest/company profiles of the enterprise, and
// rooms of this property (with the in-house stay, if any). Each group is gated by that
// module's view permission, so the palette never shows what the sidebar would hide.
// Terms under 2 characters return nothing; capped at 100 characters like the reservations list.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const q = searchParams.get("q")?.trim().slice(0, 100) ?? "";
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);
    if (q.length < 2) return NextResponse.json({ reservations: [], profiles: [], rooms: [] });

    const ci = { contains: q, mode: "insensitive" as const };
    const nameMatch = [{ firstName: ci }, { lastName: ci }, { companyName: ci }];

    const [reservations, profiles, rooms] = await Promise.all([
      hasPermission(ctx, "RESERVATIONS", "view")
        ? prisma.reservation.findMany({
            where: {
              propertyId,
              OR: [
                { confirmationNo: ci },
                { externalRef: ci },
                { primaryGuest: { OR: nameMatch } },
                { accompanyingGuests: { some: { profile: { OR: nameMatch } } } },
              ],
            },
            select: {
              id: true,
              confirmationNo: true,
              status: true,
              checkInDate: true,
              checkOutDate: true,
              primaryGuest: { select: { firstName: true, lastName: true, companyName: true } },
              assignments: { select: { room: { select: { roomNumber: true } } }, take: 1 },
            },
            // Live stays first, then the most recent arrivals.
            orderBy: [{ checkInDate: "desc" }],
            take: 6,
          })
        : [],
      hasPermission(ctx, "PROFILES", "view")
        ? prisma.profile.findMany({
            where: { enterpriseId: ctx.enterpriseId, OR: [...nameMatch, { communications: { some: { value: ci } } }] },
            select: { upid: true, firstName: true, lastName: true, companyName: true, profileType: true },
            orderBy: { updatedAt: "desc" },
            take: 5,
          })
        : [],
      hasPermission(ctx, "FRONT_DESK", "view") || hasPermission(ctx, "HOUSEKEEPING", "view")
        ? prisma.room.findMany({
            where: { propertyId, roomNumber: { startsWith: q, mode: "insensitive" } },
            select: {
              id: true,
              roomNumber: true,
              roomType: { select: { name: true } },
              RoomAssignment: {
                where: { reservation: { status: "IN_HOUSE" } },
                select: { reservation: { select: { id: true, primaryGuest: { select: { firstName: true, lastName: true, companyName: true } } } } },
                take: 1,
              },
            },
            orderBy: { roomNumber: "asc" },
            take: 5,
          })
        : [],
    ]);

    const name = (p?: { firstName?: string | null; lastName?: string | null; companyName?: string | null } | null) =>
      (p ? [p.firstName, p.lastName].filter(Boolean).join(" ") || p.companyName : null) ?? "";
    const rank = (s: string) => (s === "IN_HOUSE" ? 0 : s === "RESERVED" ? 1 : 2);

    return NextResponse.json({
      reservations: [...reservations]
        .sort((a, b) => rank(a.status) - rank(b.status))
        .map((r) => ({
          id: r.id,
          confirmationNo: r.confirmationNo,
          status: r.status,
          guest: name(r.primaryGuest),
          checkInDate: r.checkInDate,
          checkOutDate: r.checkOutDate,
          room: r.assignments[0]?.room?.roomNumber ?? null,
        })),
      profiles: profiles.map((p) => ({ upid: p.upid, name: name(p), type: p.profileType })),
      rooms: rooms.map((r) => {
        const stay = r.RoomAssignment[0]?.reservation;
        return { id: r.id, roomNumber: r.roomNumber, roomType: r.roomType?.name ?? null, reservationId: stay?.id ?? null, guest: stay ? name(stay.primaryGuest) : null };
      }),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
