"use client"

import { Printer, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

// Shared chrome for every printable document (Invoice, Payment Receipt, Currency
// Exchange Receipt) — the on-screen control bar (hidden on actual print) plus the
// white A4-ish document container and print-specific CSS. One place to fix print
// behavior for all three documents instead of three near-duplicate implementations.
const FONT_CLASSES: Record<string, string> = {
  Geist: "font-sans",
  Inter: "font-sans",
  Roboto: "font-sans",
  Georgia: "font-serif",
  Courier: "font-mono",
}

export function resolvePrintFontClass(fontFamily: string | null | undefined) {
  return (fontFamily && FONT_CLASSES[fontFamily]) || "font-sans"
}

export function PrintDocumentShell({
  previewLabel,
  fontClassName,
  children,
}: {
  previewLabel: string
  fontClassName: string
  children: React.ReactNode
}) {
  return (
    <div className={`bg-white min-h-screen text-slate-800 p-4 sm:p-12 print:p-0 ${fontClassName}`}>
      <div className="print:hidden max-w-[800px] mx-auto mb-6 bg-muted border border-border rounded-lg p-4 flex justify-between items-center sticky top-0 z-[var(--z-sticky)] shadow-sm">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => window.close()}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <span className="text-xs text-muted-foreground font-medium">{previewLabel}</span>
        </div>
        <Button onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
        </Button>
      </div>

      <div className="max-w-[800px] mx-auto print:border-0 border p-8 sm:p-12 rounded-xl shadow-sm bg-white">
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
          @page {
            size: auto;
            margin: 15mm;
          }
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
