import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

// Open folios on OTHER reservations that a charge can be moved to — the "+ Another room"
// list in the folio's Move charges dialog: every in-house reservation, plus the group
// Posting Masters (which exist to receive charges and may not have arrived yet). Folios on
// the reservation being billed are excluded; they are offered separately in the dialog.
// The client searches the list, so this is returned whole (capped).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const excludeReservationId = searchParams.get("excludeReservationId");
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const reservations = await prisma.reservation.findMany({
      where: {
        propertyId,
        ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
        OR: [{ status: "IN_HOUSE" }, { isPostingMaster: true, status: { in: ["RESERVED", "IN_HOUSE"] } }],
      },
      select: {
        id: true,
        confirmationNo: true,
        isPostingMaster: true,
        primaryGuest: { select: { firstName: true, lastName: true, companyName: true } },
        assignments: { select: { room: { select: { roomNumber: true } } }, orderBy: { startDate: "asc" }, take: 1 },
        folios: {
          where: { isClosed: false },
          select: { id: true, folioNumber: true, payeeProfile: { select: { firstName: true, lastName: true, companyName: true } } },
          orderBy: { folioNumber: "asc" },
        },
      },
      orderBy: { checkInDate: "asc" },
      take: 300,
    });

    const nameOf = (p: { firstName: string; lastName: string | null; companyName: string | null } | null | undefined) =>
      p ? p.companyName || `${p.firstName} ${p.lastName ?? ""}`.trim() || "Unnamed" : "";

    const options = reservations.flatMap((r) =>
      r.folios.map((f) => {
        const owner = nameOf(f.payeeProfile) || nameOf(r.primaryGuest);
        const room = r.assignments[0]?.room?.roomNumber ?? "TBA";
        return {
          value: f.id,
          group: r.isPostingMaster ? "Posting Masters" : "In-house",
          label: r.isPostingMaster
            ? `Posting Master · ${owner} · ${r.confirmationNo} · Folio #${f.folioNumber}`
            : `Room ${room} · ${owner} · Folio #${f.folioNumber}`,
          keywords: `${room} ${owner} ${nameOf(r.primaryGuest)} ${r.confirmationNo}`,
        };
      })
    );
    // SearchableSelect groups consecutive options — keep in-house first, masters after.
    options.sort((a, b) => (a.group === b.group ? 0 : a.group === "In-house" ? -1 : 1));

    return NextResponse.json(options);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
