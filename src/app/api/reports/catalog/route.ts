import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { reportCatalog, MODULE_ORDER } from "@/lib/reports/registry";

export const dynamic = "force-dynamic";

// The report catalog (definitions minus server-only run fns) for the Reports UI.
export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "REPORTS", "view");
    return NextResponse.json({ modules: MODULE_ORDER, reports: reportCatalog() });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
