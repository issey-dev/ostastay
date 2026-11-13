import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse, requireCapability } from "@/lib/scope";
import { POST as advanceOne } from "@/app/api/reservations/[id]/advance-bill/route";
import { logActivity } from "@/lib/activity-log";

// Advance Folio for a whole group (Agent Portal plan A-23, Phase 8): one action on the block
// posts every in-house pickup's remaining stay, each through the single-booking Advance Folio
// (same quote engine, same claim on advanceBilledThrough, same routing: master or own folio).
// In house only (owner, 2026-11-11). A pickup that cannot be posted is skipped and reported;
// the others post. Returns one line per pickup.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");
    requireCapability(ctx, "billing.advanceFolio");
    const { id } = await params;
    const block = await prisma.groupBlock.findUnique({ where: { id }, select: { propertyId: true, code: true } });
    if (!block) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    await assertPropertyAccess(ctx, block.propertyId);
    const pickups = await prisma.reservation.findMany({
      where: { groupBlockId: id, isPostingMaster: false, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
      select: { id: true, confirmationNo: true, status: true, primaryGuest: { select: { firstName: true, lastName: true } } },
      orderBy: { confirmationNo: "asc" },
    });
    const results: { reservationId: string; confirmationNo: string; guest: string; ok: boolean; amountPosted?: number; error?: string }[] = [];
    for (const p of pickups) {
      const guest = `${p.primaryGuest.firstName} ${p.primaryGuest.lastName ?? ""}`.trim();
      if (p.status !== "IN_HOUSE") {
        results.push({ reservationId: p.id, confirmationNo: p.confirmationNo, guest, ok: false, error: "Not in house" });
        continue;
      }
      const res = await advanceOne(new Request(new URL(`/api/reservations/${p.id}/advance-bill`, request.url), { method: "POST", body: "{}" }), {
        params: Promise.resolve({ id: p.id }),
      });
      const data = await res.json().catch(() => ({}));
      results.push(
        res.ok
          ? { reservationId: p.id, confirmationNo: p.confirmationNo, guest, ok: true, amountPosted: data.amountPosted }
          : { reservationId: p.id, confirmationNo: p.confirmationNo, guest, ok: false, error: data.error ?? "Failed" }
      );
    }
    const posted = results.filter((r) => r.ok);
    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "UPDATE",
      entityType: "GroupBlock",
      entityId: id,
      description: `Advance Folio for group ${block.code}: ${posted.length} of ${pickups.length} pickup(s) posted`,
    });
    return NextResponse.json({ posted: posted.length, results });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
