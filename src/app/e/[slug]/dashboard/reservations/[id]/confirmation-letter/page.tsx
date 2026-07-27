"use client"

import { useEffect, useState, use } from "react"
import { Mail } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { resolveStationeryBrand } from "@/lib/stationery-brand"
import { formatAllGuestNames, formatRoomCategories, nightsCount } from "@/lib/confirmation-letter"
import { PrintDocumentShell, PrintLoading, PrintError } from "@/components/print/print-document-shell"
import { ConfirmationLetterDocument } from "@/components/print/stationery/documents"
import type { MetaItem } from "@/components/print/stationery/blocks"

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

  if (loading) return <PrintLoading label="Preparing confirmation letter..." />
  if (error || !data) return <PrintError message={error || "Reservation not found"} />

  const { reservation, settings } = data
  const brand = resolveStationeryBrand(reservation.property)
  const guestNames = formatAllGuestNames(reservation)
  const roomCategories = formatRoomCategories(reservation.assignments)
  const nights = nightsCount(reservation.checkInDate, reservation.checkOutDate)

  const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })

  const details: MetaItem[] = [
    { label: "Confirmation No.", value: reservation.confirmationNo },
    { label: "Guest Name(s)", value: guestNames.join(", ") },
    { label: "Stay Period", value: `${fmt(reservation.checkInDate)} – ${fmt(reservation.checkOutDate)}` },
    { label: "Nights", value: String(nights) },
    { label: "Room Category", value: roomCategories.join(", ") || "To be assigned" },
    { label: "Check-in", value: `From ${reservation.property.checkInTime}` },
    { label: "Check-out", value: `Until ${reservation.property.checkOutTime}` },
    ...(reservation.remarks ? [{ label: "Remarks", value: reservation.remarks }] : []),
  ]

  const policyText =
    settings.confirmationLetterMessage ||
    "We kindly request that all guests carry a valid photo ID or passport upon arrival. This letter may be presented as confirmation of accommodation for immigration and travel purposes. Should your travel plans change, please notify us as early as possible so we can assist accordingly."

  const contactLine = [brand.phone, brand.email, brand.address].filter(Boolean).join("   ·   ")

  return (
    <PrintDocumentShell
      previewLabel={`Confirmation Letter for #${reservation.confirmationNo}`}
      fontClassName={brand.fontClass}
      extraActions={
        <>
          {sendResult && (
            <span className={`text-xs font-medium ${sendResult.isError ? "text-destructive" : "text-success"}`}>
              {sendResult.message}
            </span>
          )}
          <Button variant="outline" onClick={handleSendEmail} disabled={sending}>
            <Mail className="w-4 h-4 mr-2" /> {sending ? "Sending..." : "Email to Guest"}
          </Button>
        </>
      }
    >
      <ConfirmationLetterDocument
        brand={brand}
        guestName={guestNames[0]}
        date={new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}
        details={details}
        policyText={policyText}
        closingTeam={`${brand.name} Reservations Team`}
        footerContactLine={contactLine}
      />
    </PrintDocumentShell>
  )
}
