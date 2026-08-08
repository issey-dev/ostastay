"use client"

import { Printer } from "@/components/icons"
import { Button } from "@/components/ui/button"

// Shared chrome for every printable document (Invoice, Receipt, Confirmation Letter,
// Registration Card, Statement) — the on-screen control bar (hidden on actual print) plus
// the white A4-ish document container and print-specific CSS. One place to fix print
// behavior for every document instead of near-duplicate implementations. The document body
// itself is composed from src/components/print/stationery; font resolution lives in
// src/lib/stationery-fonts (resolveStationeryFontClass), no longer duplicated here.
//
// Deliberately minimal: just the delivery actions (Email, Print/Download), nothing else —
// no Back button, no page label. These pages render chrome-free (see DashboardShell /
// isStationeryRoute) specifically so a guest-facing document reads as clean stationery,
// not an app screen; native browser back-navigation covers "how do I leave."

export function PrintDocumentShell({
  previewLabel,
  fontClassName,
  children,
  extraActions,
  printLabel = "Print / Save as PDF",
  onPrint,
}: {
  previewLabel: string
  fontClassName: string
  children: React.ReactNode
  // Rendered before the Print button — e.g. an "Email" button.
  extraActions?: React.ReactNode
  printLabel?: string
  // Defaults to window.print(). Pass a custom handler (e.g. a server-generated PDF
  // download) to replace that behavior without duplicating the rest of the bar.
  onPrint?: () => void
}) {
  return (
    <div className={`bg-white min-h-screen text-[var(--print-ink)] p-4 sm:p-12 print:p-0 ${fontClassName}`}>
      <div className="print:hidden max-w-[800px] mx-auto mb-6 flex justify-end items-center gap-2 sticky top-0 z-[var(--z-sticky)]">
        <span className="sr-only">{previewLabel}</span>
        {extraActions}
        <Button onClick={onPrint ?? (() => window.print())}>
          <Printer className="w-4 h-4 mr-2" /> {printLabel}
        </Button>
      </div>

      {/* The page's own margin moves INSIDE the document (print:px/py below) because
          @page margin is zero — see the print CSS. On screen the padding is the same, so
          preview and printout match. */}
      <div className="max-w-[800px] mx-auto print:border-0 border p-8 sm:p-12 rounded-xl shadow-sm bg-white print:max-w-none print:rounded-none print:shadow-none print:px-[14mm] print:py-[12mm]">
        {children}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          html, body {
            background-color: white !important;
            color: black !important;
            overflow: visible !important;
            height: auto !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:p-0 {
            padding: 0 !important;
          }
          .print\\:border-0 {
            border: 0 !important;
            box-shadow: none !important;
          }
          * {
            overflow: visible !important;
            scrollbar-width: none !important;
            -ms-overflow-style: none !important;
          }
          ::-webkit-scrollbar {
            display: none !important;
          }
          /* A4 with a ZERO page margin. The browser only draws its own header and
             footer — the source URL, the date, the document title, "1/2" — into the
             @page margin box, so a non-zero margin here is what was printing that
             chrome onto every stationery. With margin:0 there is no margin box to
             draw into and the artifacts disappear without the user having to
             untick "Headers and footers" in the print dialog.

             The document's own breathing room is restored as padding INSIDE the
             page (print:px-[14mm] / print:py-[12mm] on the container above), which
             the browser cannot write into. */
          @page {
            size: A4;
            margin: 0;
          }
          /* Keep a table row, a totals block or a section heading from being split
             across a page break — the usual cause of a one-page document spilling a
             few orphaned lines onto a second sheet. */
          table { break-inside: auto; }
          tr, img { break-inside: avoid; }
          thead { display: table-header-group; }
          h1, h2, h3 { break-after: avoid; }
        }
      `}} />
    </div>
  )
}

export function PrintLoading({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex flex-col justify-center items-center gap-4 bg-background">
      <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-none animate-spin" />
      <p className="text-muted-foreground font-medium">{label}</p>
    </div>
  )
}

export function PrintError({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex flex-col justify-center items-center gap-4 bg-background">
      <div className="text-destructive font-bold text-lg">{message}</div>
      <Button onClick={() => window.close()} variant="outline">Close Tab</Button>
    </div>
  )
}
