import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { generateTablePdf } from "@/lib/pdfGenerator";
import { format } from "date-fns";

// Printable passenger manifest for one departure — for briefing a boat crew/guide
// before a trip goes out. Same generateTablePdf utility already used by the
// arrival/departure-list reports, so it looks and behaves like every other printed
// list in the app.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "EXCURSIONS", "view");

    const { id } = await params;
    const departure = await prisma.excursionDeparture.findUnique({
      where: { id },
      include: {
        excursionType: { select: { name: true, propertyId: true } },
        bookings: {
          where: { status: { not: "CANCELLED" } },
          include: {
            reservation: {
              include: {
                primaryGuest: { select: { firstName: true, lastName: true } },
                assignments: { orderBy: { startDate: "desc" }, take: 1, include: { room: { select: { roomNumber: true } } } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!departure) {
      return NextResponse.json({ error: "Departure not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, departure.excursionType.propertyId, "EXCURSIONS");

    const headers = ["Guest", "Room", "Adults", "Children", "Infants", "Status", "Notes"];
    const rows = departure.bookings.map((b) => [
      b.reservation ? `${b.reservation.primaryGuest.firstName} ${b.reservation.primaryGuest.lastName ?? ""}`.trim() : (b.walkInGuestName ?? "Walk-in"),
      b.reservation?.assignments[0]?.room?.roomNumber ?? "—",
      String(b.adultCount),
      String(b.childCount),
      String(b.infantCount),
      b.status,
      b.notes ?? "",
    ]);

    const title = `${departure.excursionType.name} — ${format(departure.departureDate, "PP")} ${departure.departureTime}${departure.meetingPoint ? ` (Meet: ${departure.meetingPoint}${departure.meetingTime ? ` at ${departure.meetingTime}` : ""})` : ""}`;
    const pdfBytes = await generateTablePdf(title, headers, rows);

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="excursion-manifest-${id}.pdf"`,
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
