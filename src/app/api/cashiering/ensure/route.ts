import { NextResponse } from "next/server";
import { requireSession, requirePermission, resolveCurrentPropertyId, toErrorResponse } from "@/lib/scope";
import { ensureOpenShift } from "@/lib/cashier-shift";

// Called by billing screens (Cashiering, Folio, POS) on mount: opening a billing
// screen auto-opens the caller's cashier drawer for the current property, even
// before anything is posted. Idempotent — returns the existing open shift if any.
export async function POST() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const propertyId = await resolveCurrentPropertyId(ctx);
    if (!propertyId) {
      return NextResponse.json({ success: false, shift: null });
    }

    const shift = await ensureOpenShift(ctx, propertyId);
    return NextResponse.json({ success: true, shift: { id: shift.id, propertyId: shift.propertyId, openedAt: shift.openedAt } });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
