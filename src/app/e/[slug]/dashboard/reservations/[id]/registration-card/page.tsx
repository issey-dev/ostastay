"use client"

import { use, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { format } from "date-fns"
import {
  PrintDocumentShell,
  PrintLoading,
  PrintError,
  resolvePrintFontClass,
} from "@/components/print/print-document-shell"
import { PrintDocumentHeader } from "@/components/print/print-blocks"
import { resolveInvoiceBrandColor } from "@/lib/invoice-branding"

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

  const brandColor = resolveInvoiceBrandColor(settings.invoiceBrandColor)
  const fontClassName = resolvePrintFontClass(settings.invoiceFontFamily)
  const brandName = settings.invoiceBrandName || reservation.property.name
  const isLead = guest.upid === reservation.primaryGuest.upid

  const guestName = guest.companyName || [guest.title, guest.firstName, guest.middleName, guest.lastName].filter(Boolean).join(" ")
  const comm = (type: string) => {
    const list = (guest.communications ?? []).filter((c: any) => c.type === type)
    return (list.find((c: any) => c.isPrimary) ?? list[0])?.value ?? null
  }
  const address = (guest.addresses ?? []).find((a: any) => a.isPrimary) ?? guest.addresses?.[0]
  const doc = (guest.documents ?? []).find((d: any) => d.isPrimary) ?? guest.documents?.[0]

  const activeAssignment = reservation.assignments?.[0]
  const nights = Math.max(
    1,
    Math.round((new Date(reservation.checkOutDate).getTime() - new Date(reservation.checkInDate).getTime()) / 86_400_000)
  )
  const terms = settings.registrationCardTerms?.trim() || DEFAULT_TERMS
  const welcome = settings.registrationCardMessage?.trim() || "Welcome — please review, complete, and sign below."

  return (
    <PrintDocumentShell
      previewLabel={`Registration Card — ${guestName} (#${reservation.confirmationNo})`}
      fontClassName={fontClassName}
    >
      <PrintDocumentHeader
        brandName={brandName}
        logoUrl={settings.invoiceLogoUrl}
        address={settings.invoiceAddress}
        phone={settings.invoicePhone}
        email={settings.invoiceEmail}
        taxId={settings.invoiceTaxId}
        brandColor={brandColor}
        title="Registration Card"
        metaRows={[
          { label: "Confirmation No", value: reservation.confirmationNo },
          { label: isLead ? "Guest" : "Accompanying Guest", value: guestName },
          { label: "Date", value: format(new Date(), "dd-MMM-yyyy") },
        ]}
      />

      <p className="mt-4 text-sm text-slate-600">{welcome}</p>

      {/* Guest + stay details, two columns like a classic reg card */}
      <div className="mt-4 grid grid-cols-1 gap-x-10 gap-y-0 sm:grid-cols-2">
        <div>
          <SectionTitle brandColor={brandColor}>Guest Details</SectionTitle>
          <Field label="Name" value={guestName} />
          <Field label="Company" value={guest.companyName && !isLead ? null : guest.companyName} />
          <Field label="Travel Agent" value={reservation.travelAgent?.companyName ?? null} />
          <Field label="Address" value={address?.fullAddress ?? null} />
          <Field label="City" value={address?.city ?? null} />
          <Field label="Postal Code" value={address?.postalCode ?? null} />
          <Field label="Country" value={address?.country ?? guest.nationality ?? null} />
          <Field label="Telephone" value={comm("MOBILE") ?? null} />
          <Field label="Email" value={comm("EMAIL") ?? null} />
          <Field label="Date of Birth" value={fmtDate(guest.dateOfBirth)} />
          <Field label="Nationality" value={guest.nationality ?? null} />
        </div>
        <div>
          <SectionTitle brandColor={brandColor}>Stay Details</SectionTitle>
          <Field label="Room" value={activeAssignment?.room?.roomNumber ?? null} />
          <Field label="Room Type" value={activeAssignment?.roomType?.name ?? null} />
          <Field label="Rate Plan" value={activeAssignment?.ratePlan?.name ?? null} />
          <Field label="Arrival" value={fmtDate(reservation.checkInDate)} />
          <Field label="Departure" value={fmtDate(reservation.checkOutDate)} />
          <Field label="Nights" value={String(nights)} />
          <Field label="Adults / Children" value={`${reservation.adults} / ${reservation.children}`} />
          <SectionTitle brandColor={brandColor} className="mt-4">Identification</SectionTitle>
          <Field label="ID Type" value={doc?.documentType ?? null} />
          <Field label="ID Number" value={doc?.documentNumber ?? null} />
          <Field label="Issuing Country" value={doc?.issuingCountry ?? null} />
          <Field label="Expiry Date" value={fmtDate(doc?.expiryDate)} />
        </div>
      </div>

      {/* Terms & Conditions */}
      <div className="mt-6">
        <SectionTitle brandColor={brandColor}>Terms &amp; Conditions</SectionTitle>
        <p className="text-[11px] leading-relaxed text-slate-600 whitespace-pre-line">{terms}</p>
      </div>

      {/* Signatures */}
      <div className="mt-10 grid grid-cols-2 gap-10">
        <SignatureLine caption="Guest Signature" />
        <SignatureLine caption="Front Office" />
      </div>
    </PrintDocumentShell>
  )
}

function SectionTitle({ children, brandColor, className = "" }: { children: React.ReactNode; brandColor: string; className?: string }) {
  return (
    <p
      className={`mb-2 pb-1 text-xs font-semibold uppercase tracking-wide ${className}`}
      style={{ color: brandColor, borderBottom: `1px solid ${brandColor}33` }}
    >
      {children}
    </p>
  )
}

// A labelled field. When the value is known it prints it; otherwise it leaves a blank
// writable line so the guest can complete it by hand after printing.
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-2 py-1 text-sm">
      <span className="w-32 shrink-0 text-slate-500">{label}</span>
      {value ? (
        <span className="font-medium text-slate-800">{value}</span>
      ) : (
        <span className="min-w-[120px] flex-1 border-b border-dashed border-slate-300">&nbsp;</span>
      )}
    </div>
  )
}

function SignatureLine({ caption }: { caption: string }) {
  return (
    <div>
      <div className="h-10 border-b border-slate-400" />
      <p className="mt-1 text-xs text-slate-500">{caption}</p>
    </div>
  )
}
