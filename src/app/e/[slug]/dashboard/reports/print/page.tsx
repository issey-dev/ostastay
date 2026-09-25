import { redirect } from "next/navigation"
import { requireSession, UnauthorizedError, ForbiddenError } from "@/lib/scope"
import { decodeReportRequest, reportIsLandscape, runReport, ReportRequestError } from "@/lib/reports/run"
import { ReportDocument } from "@/components/reports/report-document"

// The report as a bare printable page — the source headless Chrome prints the report PDF
// from (see generateReportPdf in src/lib/stationery-pdf.ts). Chrome-free because the path
// ends in /print (isStationeryRoute). The request arrives base64url-encoded in `?r=`.
//
// Server-rendered: it runs the report itself with the viewer's own session, so it can
// never show data the viewer couldn't have requested through the API.

export default async function ReportPrintPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { r } = await searchParams
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/api/auth/session-expired")

  const request = decodeReportRequest(r)
  if (!request) return <Problem message="This report link is incomplete." />

  let run: Awaited<ReturnType<typeof runReport>>
  try {
    run = await runReport(ctx, request)
  } catch (e) {
    if (e instanceof ReportRequestError || e instanceof UnauthorizedError || e instanceof ForbiddenError) {
      return <Problem message={e.message} />
    }
    throw e
  }

  const orientation = reportIsLandscape(run.result) ? "landscape" : "portrait"
  return (
    <div className="min-h-screen bg-white p-6 print:p-0">
      {/* Phones only, never in the printed/PDF output. */}
      <p className="mb-4 rounded-xl border border-dashed border-border bg-muted/40 p-3 text-sm text-[var(--print-muted)] md:hidden print:hidden">
        <span className="font-medium text-[var(--print-ink)]">Print from a computer.</span> This report is laid out
        for A4 paper; on a phone, download the PDF from the Reports page instead.
      </p>
      <div className={`mx-auto ${orientation === "landscape" ? "max-w-[1100px]" : "max-w-[800px]"}`}>
        <ReportDocument result={run.result} branding={run.branding} />
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @page { size: A4 ${orientation}; margin: 12mm 12mm 14mm; }
            html, body { background: white !important; }
            .report-document { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            @media print {
              /* Column headings repeat on every page; the grand total prints once, at the end. */
              .report-document thead { display: table-header-group; }
              .report-document .report-totals { display: table-row-group; }
              .report-document tr { break-inside: avoid; }
              .report-document header { break-after: avoid; }
            }
          `,
        }}
      />
    </div>
  )
}

function Problem({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-6">
      <p className="text-sm text-[var(--print-muted)]">{message}</p>
    </div>
  )
}
