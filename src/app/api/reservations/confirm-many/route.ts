import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { confirmMany } from "@/lib/reservations/options";

// "Confirm selected" (Group Blocks, Agent Portal plan A-13): many tentative bookings at
// once, each claimed on its own and reported per booking.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string").slice(0, 200) : [];
    if (ids.length === 0) return NextResponse.json({ error: "Choose at least one booking" }, { status: 400 });
    const results = await confirmMany(ctx, ids, typeof body.note === "string" ? body.note.trim() || null : null);
    return NextResponse.json({ results, confirmed: results.filter((r) => r.ok).length });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
