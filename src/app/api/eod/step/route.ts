import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { runEodStep } from "@/lib/night-audit/eod-step";

// Advance one EOD step for a property. Steps run in order; each is idempotent —
// re-running a done step is a no-op. See src/lib/eod.ts and src/lib/night-audit/eod-step.ts.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "NIGHT_AUDIT", "create");
    return await runEodStep(ctx, await request.json());
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
