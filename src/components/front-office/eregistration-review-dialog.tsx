"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2 } from "@/components/icons"

type Slot = {
  id: string
  firstName: string | null
  middleName: string | null
  lastName: string | null
  dateOfBirth: string | null
  nationality: string | null
  gender: string | null
  email: string | null
  mobile: string | null
  addressFull: string | null
  addressCity: string | null
  addressCountry: string | null
  documentType: string | null
  documentNumber: string | null
  issuingCountry: string | null
  documentIssueDate: string | null
  documentExpiryDate: string | null
  idPhotoPath: string | null
  signatureDataUrl: string | null
  submittedAt: string | null
  existingProfileId: string | null
}

type Props = {
  reservationId: string
  slot: Slot | null
  onClose: () => void
  onApplied: () => void
}

const FIELD_GROUPS: { key: "personal" | "contact" | "address" | "document"; label: string }[] = [
  { key: "personal", label: "Personal details (name, date of birth, nationality, gender)" },
  { key: "contact", label: "Contact (email, mobile) — only fills a gap, never overwrites an existing entry" },
  { key: "address", label: "Address — only fills a gap, never overwrites an existing entry" },
  { key: "document", label: "ID document + photo" },
]

// Staff review of one guest's eRegistration submission before it's merged into the live
// Profile/ProfileDocument records — a diff, not a silent bulk overwrite, since the
// wizard's own Identification step already lets staff hand-edit DOB/nationality moments
// earlier in the same session.
export function EregistrationReviewDialog({ reservationId, slot, onClose, onApplied }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(FIELD_GROUPS.map((f) => f.key)))
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (slot) setSelected(new Set(FIELD_GROUPS.map((f) => f.key)))
  }, [slot?.id])

  if (!slot) return null

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const isNewGuest = !slot.existingProfileId
  const fullName = [slot.firstName, slot.middleName, slot.lastName].filter(Boolean).join(" ")

  const apply = async () => {
    setApplying(true)
    setError(null)
    try {
      const res = await fetch(`/api/reservations/${reservationId}/eregistration-link/slots/${slot.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: Array.from(selected) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || "Failed to apply.")
        return
      }
      onApplied()
    } catch {
      setError("An unexpected error occurred.")
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Review eRegistration submission</DialogTitle>
          <DialogDescription>
            {fullName || "This guest"} submitted this {slot.submittedAt ? `on ${new Date(slot.submittedAt).toLocaleString()}` : ""}.
            {isNewGuest && " They weren't previously linked to this reservation — applying creates a new guest profile."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border p-3">
            <div className="text-muted-foreground">Name</div><div>{fullName || "—"}</div>
            <div className="text-muted-foreground">Date of Birth</div><div>{slot.dateOfBirth ? new Date(slot.dateOfBirth).toLocaleDateString() : "—"}</div>
            <div className="text-muted-foreground">Nationality</div><div>{slot.nationality || "—"}</div>
            <div className="text-muted-foreground">Email / Mobile</div><div>{[slot.email, slot.mobile].filter(Boolean).join(" / ") || "—"}</div>
            <div className="text-muted-foreground">Address</div><div>{[slot.addressFull, slot.addressCity, slot.addressCountry].filter(Boolean).join(", ") || "—"}</div>
            <div className="text-muted-foreground">Document</div><div>{[slot.documentType, slot.documentNumber, slot.issuingCountry].filter(Boolean).join(" · ") || "—"}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {slot.idPhotoPath && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">ID Photo</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/reservations/${reservationId}/eregistration-link/slots/${slot.id}/photo`}
                  alt="Submitted ID"
                  className="h-24 w-full rounded border object-cover"
                />
              </div>
            )}
            {slot.signatureDataUrl && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Signature</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slot.signatureDataUrl} alt="Guest signature" className="h-24 w-full rounded border bg-white object-contain" />
              </div>
            )}
          </div>

          {!isNewGuest && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Apply to the guest profile:</p>
              {FIELD_GROUPS.map((f) => (
                <label key={f.key} className="flex items-start gap-2 text-xs cursor-pointer">
                  <Checkbox checked={selected.has(f.key)} onCheckedChange={() => toggle(f.key)} className="mt-0.5" />
                  {f.label}
                </label>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={apply} disabled={applying}>
            {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isNewGuest ? "Add guest & apply" : "Apply selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
