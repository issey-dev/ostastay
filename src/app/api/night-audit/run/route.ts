import { NextResponse } from "next/server"
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope"
import { runNightAudit } from "@/lib/night-audit/run"

// Run tonight's Night Audit for a property — see src/lib/night-audit/run.ts.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "NIGHT_AUDIT", "create")
    return await runNightAudit(ctx, await request.json())
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
