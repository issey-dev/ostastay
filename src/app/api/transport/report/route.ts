import { NextResponse } from "next/server"
import { handle, opsGate, propertyIdFrom } from "@/lib/transport/http"
import { transportReportResult, TRANSPORT_REPORTS } from "@/lib/transport/report"
import { invalid } from "@/lib/transport/common"
import { DATE_KEY } from "@/lib/transport/constants"
import { addDaysKey } from "@/lib/transport/time"
import { loadBranding, renderReport } from "@/lib/reports/engine"
import { consumeRateLimit, rateLimitHeaders } from "@/lib/website-api/rate-limit"
import { logActivity } from "@/lib/activity-log"
import { BookingError } from "@/lib/booking-error"

// GET /api/transport/report?propertyId=&from=&to=&format=csv|pdf|xlsx|json — the Daily
// Transportation Report from the board. TRANSPORTATION view; at most 62 days; rate-limited
// per user (10 a minute) since a month of transfers is a heavy read. Files go through the
// report engine's renderers, the same as Daily Reports.
const FORMATS = ["csv", "pdf", "xlsx", "json"] as const

export async function GET(request: Request) {
  return handle(async () => {
    const propertyId = propertyIdFrom(request)
    const { ctx } = await opsGate(propertyId, "view")
    const sp = new URL(request.url).searchParams
    const from = sp.get("from") ?? ""
    const to = sp.get("to") || from
    if (!DATE_KEY.test(from) || !DATE_KEY.test(to) || to < from) throw invalid("from/to are required (yyyy-MM-dd), to on or after from")
    if (addDaysKey(from, 62) < to) throw invalid("At most 62 days at a time")
    const format = (FORMATS as readonly string[]).includes(sp.get("format") ?? "") ? (sp.get("format") as (typeof FORMATS)[number]) : "csv"

    const quota = await consumeRateLimit("export", `transport-report:${ctx.userId}`)
    if (!quota.allowed) {
      throw new BookingError(429, "RATE_LIMITED", `Too many exports — try again in ${quota.resetSeconds} seconds.`)
    }
    const result = await transportReportResult(propertyId, from, to)
    if (format === "json") return NextResponse.json(result, { headers: { "Cache-Control": "no-store", ...rateLimitHeaders(quota) } })
    const branding = await loadBranding(ctx, propertyId)
    // The board's CSV keeps its original shape (title block, subtotals) for anyone importing it.
    const file = await renderReport(TRANSPORT_REPORTS[0], result, branding, format, { layout: "presentation", encoding: "utf8", lineEnding: "lf" })
    await logActivity({
      ctx,
      module: "REPORTS",
      action: "EXPORT",
      description: `Downloaded "Daily Transportation Report" as ${format.toUpperCase()}`,
      entityType: "Report",
      entityId: "transport-daily",
      metadata: { format, propertyId, from, to },
    })
    return new NextResponse(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
        ...rateLimitHeaders(quota),
      },
    })
  })
}
