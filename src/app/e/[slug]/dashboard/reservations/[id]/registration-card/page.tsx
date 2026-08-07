"use client"

import { use, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { format } from "date-fns"
import { PrintDocumentShell, PrintLoading, PrintError } from "@/components/print/print-document-shell"
import { RegistrationCardDocument } from "@/components/print/stationery/documents"
import type { FieldItem, MetaItem } from "@/components/print/stationery/blocks"
import { resolveStationeryBrand } from "@/lib/stationery-brand"

// A registration card is printed per guest, then completed by hand and signed. Any field
// the system doesn't know is rendered as a blank writable line so the guest can fill it in.
const DEFAULT_TERMS =
  "I have read, understood and agree to abide by the hotel's terms & conditions. " +
  "The room tariff is per night and exclusive of taxes unless stated otherwise. Bills " +
  "must be settled on presentation. The hotel is not responsible for valuables not " +
  "deposited at the front office. Guests are responsible for any loss or damage to hotel " +
  "property. Check-out time and hotel policies apply as advised at the front desk."

const fmtDate = (d?: string | Date | null) => (d ? format(new Date(d), "dd-MMM-yyyy") : null)

export default function RegistrationCardPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const guestParam = searchParams.get("guest") // profile upid; defaults to the lead guest

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/reservations/${id}/registration-card-data`)
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e.error || "Failed to load"))))
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(typeof e === "string" ? e : "Failed to load the registration card") })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id])

  const reservation = data?.reservation
  const settings = data?.settings

  // Resolve the target guest (lead by default) from the reservation's people.
  const guest = useMemo(() => {
    if (!reservation) return null
    const people = [reservation.primaryGuest, ...(reservation.accompanyingGuests ?? []).map((a: any) => a.profile)]
    if (guestParam) return people.find((p: any) => p?.upid === guestParam) ?? reservation.primaryGuest
    return reservation.primaryGuest
  }, [reservation, guestParam])

  if (loading) return <PrintLoading label="Loading registration card…" />
  if (error || !reservation || !guest) return <PrintError message={error || "Registration card not found"} />

  const brand = resolveStationeryBrand(reservation.property)
  const isLead = guest.upid === reservation.primaryGuest.upid

  const guestName = guest.companyName || [guest.title, guest.firstName, guest.middleName, guest.lastName].filter(Boolean).join(" ")
  const comm = (type: string) => {
    const list = (guest.communications ?? []).filter((c: any) => c.type === type)
    return (list.find((c: any) => c.isPrimary) ?? list[0])?.value ?? null
  }
  const address = (guest.addresses ?? []).find((a: any) => a.isPrimary) ?? guest.addresses?.[0]
  const doc = (guest.documents ?? []).find((d: any) => d.isPrimary) ?? guest.documents?.[0]

  const eregSignature = data?.eregistrationSignatures?.[guest.upid] ?? null
  const guestSignature = eregSignature
    ? { dataUrl: eregSignature.dataUrl, capturedLabel: format(new Date(eregSignature.submittedAt), "dd-MMM-yyyy, h:mm a") }
    : null

  const activeAssignment = reservation.assignments?.[0]
  const nights = Math.max(
    1,
    Math.round((new Date(reservation.checkOutDate).getTime() - new Date(reservation.checkInDate).getTime()) / 86_400_000)
  )
  const terms = settings.registrationCardTerms?.trim() || DEFAULT_TERMS
  const welcome = settings.registrationCardMessage?.trim() || "Welcome — please review, complete, and sign below."

  const meta: MetaItem[] = [
    { label: "Confirmation", value: reservation.confirmationNo },
    { label: isLead ? "Guest" : "Accompanying Guest", value: guestName },
    { label: "Date", value: format(new Date(), "dd-MMM-yyyy") },
  ]

  const guestDetails: FieldItem[] = [
    { label: "Name", value: guestName },
    { label: "Company", value: guest.companyName && !isLead ? null : guest.companyName },
    { label: "Travel agent", value: reservation.travelAgent?.companyName ?? null },
    { label: "Address", value: address?.fullAddress ?? null },
    { label: "City", value: address?.city ?? null },
    { label: "Postal code", value: address?.postalCode ?? null },
    { label: "Country", value: address?.country ?? guest.nationality ?? null },
    { label: "Telephone", value: comm("MOBILE") },
    { label: "Email", value: comm("EMAIL") },
    { label: "Date of birth", value: fmtDate(guest.dateOfBirth) },
    { label: "Nationality", value: guest.nationality ?? null },
  ]

  const stayDetails: FieldItem[] = [
    { label: "Room", value: activeAssignment?.room?.roomNumber ?? null },
    { label: "Room type", value: activeAssignment?.roomType?.name ?? null },
    { label: "Rate plan", value: activeAssignment?.ratePlan?.name ?? null },
    { label: "Arrival", value: fmtDate(reservation.checkInDate) },
    { label: "Departure", value: fmtDate(reservation.checkOutDate) },
    { label: "Nights", value: String(nights) },
    { label: "Adults / Children", value: `${reservation.adults} / ${reservation.children}` },
  ]

  const identification: FieldItem[] = [
    { label: "ID type", value: doc?.documentType ?? null },
    { label: "ID number", value: doc?.documentNumber ?? null },
    { label: "Issuing country", value: doc?.issuingCountry ?? null },
    { label: "Expiry date", value: fmtDate(doc?.expiryDate) },
  ]

  return (
    <PrintDocumentShell
      previewLabel={`Registration Card — ${guestName} (#${reservation.confirmationNo})`}
      fontClassName={brand.fontClass}
    >
      <RegistrationCardDocument
        brand={brand}
        meta={meta}
        welcomeMessage={welcome}
        guestDetails={guestDetails}
        stayDetails={stayDetails}
        identification={identification}
        terms={terms}
        guestSignature={guestSignature}
      />
    </PrintDocumentShell>
  )
}
