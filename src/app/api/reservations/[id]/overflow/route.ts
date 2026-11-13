import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { markOverflow, clearOverflow, OverflowError } from "@/lib/reservations/overflow";

// Overflow (Agent Portal plan A-8):
//   { action: "mark", hotelName, note? }                  move the booking to a partner hotel
//   { action: "clear", roomTypeId, acknowledgeOverbook? }  bring it back into a real room type
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body?.action === "mark") {
      return NextResponse.json(await markOverflow(ctx, id, { hotelName: body.hotelName, note: body.note }));
    }
    if (body?.action === "clear") {
      return NextResponse.json(
        await clearOverflow(ctx, id, { roomTypeId: String(body.roomTypeId ?? ""), acknowledgeOverbook: body.acknowledgeOverbook === true })
      );
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof OverflowError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
