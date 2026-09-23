import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { checkOutReservation } from "@/lib/reservations/check-out";

// Check a guest out — see src/lib/reservations/check-out.ts.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    return await checkOutReservation(ctx, id, { early: body?.early === true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
