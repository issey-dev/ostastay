import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, resolveCurrentPropertyId, toErrorResponse } from "@/lib/scope";

// The in-house guests a cashier can link a currency exchange to: one option per in-house
// reservation, labelled "Room · Guest", searchable by room, name or confirmation number.
export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "view");
    const propertyId = await resolveCurrentPropertyId(ctx);
    if (!propertyId) return NextResponse.json([]);

    const reservations = await prisma.reservation.findMany({
      where: { propertyId, status: "IN_HOUSE", isPostingMaster: false },
      select: {
        id: true,
        confirmationNo: true,
        primaryGuest: { select: { firstName: true, lastName: true, companyName: true } },
        assignments: { select: { room: { select: { roomNumber: true } } }, orderBy: { startDate: "asc" } },
      },
      orderBy: { checkInDate: "asc" },
      take: 500,
    });

    return NextResponse.json(
      reservations.map((r) => {
        const g = r.primaryGuest;
        const name = g ? g.companyName || `${g.firstName} ${g.lastName ?? ""}`.trim() : "Guest";
        const rooms = [...new Set(r.assignments.map((a) => a.room?.roomNumber).filter(Boolean))].join(", ") || "TBA";
        return { value: r.id, label: `Room ${rooms} · ${name}`, guestName: name, keywords: `${rooms} ${name} ${r.confirmationNo}` };
      })
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
