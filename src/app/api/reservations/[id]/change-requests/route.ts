import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { emitForReservation } from "@/lib/agent-api/events";

// An agent's requests to amend or cancel this booking (Agent Portal plan A-15). GET lists them;
// POST { id, action: "accept" | "decline", note? } records the hotel's decision and tells the
// agent. Accepting does not change the booking by itself: staff then make the change at the
// desk (edit, or cancel with the usual fee rules), so every money rule still applies.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "view");
    const { id } = await params;
    const r = await prisma.reservation.findUnique({ where: { id }, select: { propertyId: true } });
    if (!r) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, r.propertyId);
    const rows = await prisma.agentChangeRequest.findMany({ where: { reservationId: id }, orderBy: { createdAt: "desc" } });
    const users = await prisma.agentUser.findMany({ where: { id: { in: rows.map((x) => x.agentUserId) } }, select: { id: true, name: true, email: true } });
    return NextResponse.json(rows.map((x) => ({ ...x, agent: users.find((u) => u.id === x.agentUserId) ?? null })));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const r = await prisma.reservation.findUnique({ where: { id }, select: { propertyId: true, confirmationNo: true } });
    if (!r) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, r.propertyId);
    const action = body?.action === "accept" ? "ACCEPTED" : body?.action === "decline" ? "DECLINED" : null;
    if (!action) return NextResponse.json({ error: "action is accept or decline" }, { status: 400 });
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null;
    if (action === "DECLINED" && !note) return NextResponse.json({ error: "Give the agent a reason." }, { status: 400 });
    const c = await prisma.agentChangeRequest.updateMany({
      where: { id: String(body.id ?? ""), reservationId: id, status: "PENDING" },
      data: { status: action, decisionNote: note, decidedBy: ctx.userId, decidedAt: new Date() },
    });
    if (c.count === 0) return NextResponse.json({ error: "That request was already decided." }, { status: 409 });
    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "UPDATE",
      entityType: "Reservation",
      entityId: id,
      description: `Agent change request on ${r.confirmationNo} ${action.toLowerCase()}${note ? `: ${note}` : ""}`,
    });
    await emitForReservation(id, "change_request.decided");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
