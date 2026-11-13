import { NextResponse } from "next/server";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { approveCommissions, listCommissions, payCommissions } from "@/lib/commission-ledger";

// Debtors › Commissions (Agent Portal plan A-19, §8). GET ?propertyId&status&profileId lists
// the ledger. POST:
//   { action: "approve", propertyId, ids }
//   { action: "pay", propertyId, ids, method: BANK_TRANSFER | CASH | CHEQUE | OFFSET, reference? }
// Paying or offsetting needs DEBTORS update and "Pay or offset commission" (debtors.payCommission).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "DEBTORS", "view");
    const u = new URL(request.url).searchParams;
    const propertyId = u.get("propertyId") ?? "";
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);
    return NextResponse.json(await listCommissions(propertyId, { status: u.get("status"), profileId: u.get("profileId") }));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "DEBTORS", "update");
    const body = await request.json().catch(() => ({}));
    const propertyId = String(body?.propertyId ?? "");
    await assertPropertyAccess(ctx, propertyId);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string") : [];
    if (ids.length === 0) return NextResponse.json({ error: "Choose at least one row" }, { status: 400 });
    if (body.action === "approve") return NextResponse.json({ approved: await approveCommissions(ctx, propertyId, ids) });
    if (body.action === "pay") {
      try {
        const payout = await payCommissions(ctx, propertyId, { ids, method: String(body.method ?? ""), reference: body.reference });
        if (!payout) return NextResponse.json({ error: "Nothing to pay in that selection." }, { status: 400 });
        return NextResponse.json(payout);
      } catch (e) {
        if (e instanceof Error && e.message === "ONE_AGENT") return NextResponse.json({ error: "Pay one agent at a time." }, { status: 400 });
        if (e instanceof Error && e.message === "METHOD") return NextResponse.json({ error: "Choose how it was paid." }, { status: 400 });
        throw e;
      }
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
