"use client"

import { useEffect, useState, use } from "react"
import { Printer, ArrowLeft, Loader2, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { resolveInvoiceBrandColor } from "@/lib/invoice-branding"
import { formatAllGuestNames, formatRoomCategories, nightsCount } from "@/lib/confirmation-letter"

export default function ConfirmationLetterPage({ params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ message: string; isError?: boolean } | null>(null)

  useEffect(() => {
    fetch(`/api/reservations/${id}/confirmation-letter-data`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((json) => setData(json))
      .catch(() => setError("Failed to load reservation data."))
      .finally(() => setLoading(false))
  }, [id])

  const handleSendEmail = async () => {
    setSending(true)
    setSendResult(null)
    try {
      const res = await fetch(`/api/reservations/${id}/send-confirmation`, { method: "POST" })
      const body = await res.json()
      if (res.ok) {
        setSendResult({ message: `Sent to ${body.sentTo}.` })
      } else {
        setSendResult({ message: body.error || "Failed to send.", isError: true })
      }
    } catch {
      setSendResult({ message: "An unexpected error occurred.", isError: true })
    } finally {
      setSending(false)
      setTimeout(() => setSendResult(null), 6000)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center gap-4 bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium">Preparing confirmation letter...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center gap-4 bg-background">
        <div className="text-destructive font-bold text-lg">{error || "Reservation not found"}</div>
        <Button onClick={() => window.close()} variant="outline">Close Tab</Button>
      </div>
    )
  }

  const { reservation, settings } = data
  const guestNames = formatAllGuestNames(reservation)
  const roomCategories = formatRoomCategories(reservation.assignments)
  const nights = nightsCount(reservation.checkInDate, reservation.checkOutDate)
  const brandColor = resolveInvoiceBrandColor(settings.invoiceBrandColor)
  const brandName = settings.invoiceBrandName || reservation.property.name

  const fontFamilies: Record<string, string> = {
    Geist: "font-sans", Inter: "font-sans", Roboto: "font-sans",
    Georgia: "font-serif", Courier: "font-mono",
  }
  const selectedFont = fontFamilies[settings.invoiceFontFamily] || "font-sans"

  const policyText = settings.confirmationLetterMessage
    || `Check-in time is from ${reservation.property.checkInTime} and check-out time is until ${reservation.property.checkOutTime}. We kindly request that all guests carry a valid photo ID or passport upon arrival. This letter may be presented as confirmation of accommodation for immigration and travel purposes. Should your travel plans change, please notify us as early as possible so we can assist accordingly.`

  return (
    <div className={`bg-white min-h-screen text-slate-800 p-4 sm:p-12 print:p-0 ${selectedFont}`}>
      {/* Control bar - hidden during print */}
      <div className="print:hidden max-w-[800px] mx-auto mb-6 bg-muted border border-border rounded-lg p-4 flex justify-between items-center sticky top-0 z-[var(--z-sticky)] shadow-sm">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => window.close()}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <span className="text-xs text-muted-foreground font-medium">Confirmation Letter for #{reservation.confirmationNo}</span>
        </div>
        <div className="flex items-center gap-2">
          {sendResult && (
            <span className={`text-xs font-medium ${sendResult.isError ? "text-destructive" : "text-success"}`}>{sendResult.message}</span>
          )}
          <Button variant="outline" onClick={handleSendEmail} disabled={sending}>
            <Mail className="w-4 h-4 mr-2" /> {sending ? "Sending..." : "Email to Guest"}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
          </Button>
        </div>
      </div>

      {/* Letter Document */}
      <div className="max-w-[800px] mx-auto print:border-0 border rounded-xl shadow-sm bg-white overflow-hidden flex">
        {/* Colored accent strip — a simplified nod to a branded letterhead, using the
            enterprise's own configured brand color rather than a fixed illustration. */}
        <div className="w-3 shrink-0 print:w-3" style={{ backgroundColor: brandColor }} />

        <div className="flex-1 p-8 sm:p-12">
          {/* Header */}
          <div className="flex justify-between items-start border-b-2 pb-6 mb-8" style={{ borderBottomColor: brandColor }}>
            <div>
              {settings.invoiceLogoUrl ? (
                <img
                  src={settings.invoiceLogoUrl}
                  alt="Brand Logo"
                  className="max-h-16 max-w-[220px] object-contain"
                  onError={(e) => { e.currentTarget.style.display = "none" }}
                />
              ) : (
                <h1 className="text-2xl font-bold tracking-tight uppercase" style={{ color: brandColor }}>
                  {brandName}
                </h1>
              )}
            </div>
            <div className="text-right text-xs text-slate-500 space-y-0.5">
              {settings.invoiceAddress && <p className="whitespace-pre-line">{settings.invoiceAddress}</p>}
              {settings.invoicePhone && <p>{settings.invoicePhone}</p>}
              {settings.invoiceEmail && <p>{settings.invoiceEmail}</p>}
            </div>
          </div>

          {/* Salutation + Date */}
          <div className="flex justify-between items-baseline mb-6">
            <div>
              <p className="text-sm text-slate-500">Dear</p>
              <p className="text-xl font-bold text-slate-900">{guestNames[0]}</p>
            </div>
            <p className="text-sm text-slate-500">
              {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>

          {/* Intro */}
          <p className="text-sm leading-relaxed text-slate-700 mb-8">
            We are delighted to confirm your upcoming reservation with {brandName}. Please find the
            details of your stay below — this letter may be presented as confirmation of
            accommodation where required.
          </p>

          {/* Details */}
          <div className="bg-slate-50 border border-slate-100 rounded-lg p-6 mb-8 text-sm">
            <dl className="grid grid-cols-[160px_1fr] gap-y-3">
              <dt className="text-slate-500 font-medium">Confirmation No.</dt>
              <dd className="font-semibold text-slate-900">{reservation.confirmationNo}</dd>

              <dt className="text-slate-500 font-medium">Guest Name(s)</dt>
              <dd className="font-semibold text-slate-900">{guestNames.join(", ")}</dd>

              <dt className="text-slate-500 font-medium">Stay Period</dt>
              <dd className="font-semibold text-slate-900">
                {new Date(reservation.checkInDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                {" – "}
                {new Date(reservation.checkOutDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </dd>

              <dt className="text-slate-500 font-medium">Nights</dt>
              <dd className="font-semibold text-slate-900">{nights}</dd>

              <dt className="text-slate-500 font-medium">Room Category</dt>
              <dd className="font-semibold text-slate-900">{roomCategories.join(", ") || "To be assigned"}</dd>

              {reservation.remarks && (
                <>
                  <dt className="text-slate-500 font-medium">Remarks</dt>
                  <dd className="text-slate-900">{reservation.remarks}</dd>
                </>
              )}
            </dl>
          </div>

          {/* Generic hotel info / policy */}
          <p className="text-xs leading-relaxed text-slate-600 mb-10">{policyText}</p>

          {/* Sign-off */}
          <p className="text-sm text-slate-700">We look forward to welcoming you.</p>
          <p className="text-sm text-slate-700 mt-4">
            Warm regards,<br />
            <span className="font-semibold text-slate-900">{brandName} Reservations Team</span>
          </p>

          {/* Footer */}
          <div className="border-t border-slate-100 mt-12 pt-4 text-[10px] text-slate-400 text-center">
            {[settings.invoicePhone, settings.invoiceAddress, settings.invoiceEmail].filter(Boolean).join("  •  ")}
          </div>
        </div>
      </div>

      {/* Inject print-specific styling */}
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
