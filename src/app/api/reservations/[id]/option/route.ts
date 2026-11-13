import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { confirmTentative, extendOption, releaseTentative, reinstateAsTentative, OptionError } from "@/lib/reservations/options";

// The option panel on a tentative reservation (Agent Portal plan §7, Phase 1):
//   { action: "confirm", note? }            TENTATIVE → RESERVED
//   { action: "extend", optionDate }        move the option date
//   { action: "release", reasonCode?, reason? }  TENTATIVE → CANCELLED, kept as a record
//   { action: "reinstate" }                 CANCELLED → TENTATIVE, availability re-checked
// Every action also needs the "Confirm, extend or release an option" capability.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    let result;
    if (action === "confirm") {
      result = await confirmTentative(ctx, id, typeof body.note === "string" ? body.note.trim() || null : null);
    } else if (action === "extend") {
      const d = typeof body.optionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.optionDate) ? new Date(`${body.optionDate}T00:00:00Z`) : null;
      if (!d) return NextResponse.json({ error: "optionDate (yyyy-MM-dd) is required" }, { status: 400 });
      result = await extendOption(ctx, id, d);
    } else if (action === "release") {
      result = await releaseTentative(ctx, id, {
        reasonCode: typeof body.reasonCode === "string" ? body.reasonCode : null,
        reason: typeof body.reason === "string" ? body.reason : null,
      });
    } else if (action === "reinstate") {
      result = await reinstateAsTentative(ctx, id);
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OptionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
