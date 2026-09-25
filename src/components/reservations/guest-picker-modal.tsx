"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Star, Search, UserPlus } from "@/components/icons"
import { SubmitButton } from "@/components/ui/submit-button"
import { InlineLoading } from "@/components/ui/inline-loading"
import { EmptyState } from "@/components/ui/empty-state"
import { INPUT_EMAIL, INPUT_PHONE, INPUT_SEARCH } from "@/lib/input-presets"

export type GuestProfile = {
  upid: string
  firstName: string
  lastName?: string | null
  profileType: string
  vipLevel?: string | null
  communications?: { type: string; value: string }[]
  addresses?: { fullAddress: string }[]
}

type GuestPickerModalProps = {
  isOpen: boolean
  onClose: () => void
  enterpriseId: string
  onSelect: (profile: GuestProfile) => void
  excludeIds?: string[]
  title?: string
}

// Reusable Guest/Primary-Guest picker: searches existing profiles by first name, last
// name, email, or address (server-side, not limited to whatever the form happened to
// fetch at mount) and — if the person isn't found — lets staff quick-create a minimal
// profile inline without leaving the booking flow. Used for both Primary Guest and
// Accompanying Guest selection in booking-form.tsx.
export function GuestPickerModal({ isOpen, onClose, enterpriseId, onSelect, excludeIds = [], title = "Select guest" }: GuestPickerModalProps) {
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<GuestProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [quickCreate, setQuickCreate] = useState({ firstName: "", lastName: "", email: "", phone: "" })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) return
    setSearch("")
    setResults([])
    setShowQuickCreate(false)
    setQuickCreate({ firstName: "", lastName: "", email: "", phone: "" })
    setError(null)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !enterpriseId) return
    setLoading(true)
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ enterpriseId, profileType: "GUEST" })
      if (search.trim()) params.set("search", search.trim())
      fetch(`/api/profiles?${params.toString()}`)
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setResults(data) })
        .catch(console.error)
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(handle)
  }, [isOpen, enterpriseId, search])

  const visibleResults = results.filter(p => !excludeIds.includes(p.upid))

  const handleSelect = (p: GuestProfile) => {
    onSelect(p)
    onClose()
  }

  // Quick-create starts from what was typed in the search box, so the name isn't typed
  // twice: "Anna Maria Silva" → first "Anna Maria", last "Silva"; a single word is taken as
  // the last name (desks usually search by surname). An email or phone isn't a name — skip it.
  const openQuickCreate = () => {
    const typed = search.trim().replace(/\s+/g, " ")
    if (typed && !/[@\d]/.test(typed)) {
      const parts = typed.split(" ")
      const lastName = parts.pop() ?? ""
      setQuickCreate(p => ({ ...p, firstName: parts.join(" "), lastName }))
    }
    setShowQuickCreate(true)
  }

  // A real <form> so Enter creates (DESKTOP_PLAN D10). This modal is opened from inside the
  // booking form, and React submit events bubble through portals — stop it here so Enter
  // never also submits the booking.
  const handleQuickCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!quickCreate.firstName.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      const communications = [
        ...(quickCreate.email.trim() ? [{ type: "EMAIL", value: quickCreate.email.trim(), isPrimary: true }] : []),
        ...(quickCreate.phone.trim() ? [{ type: "MOBILE", value: quickCreate.phone.trim(), isPrimary: !quickCreate.email.trim() }] : []),
      ]
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileType: "GUEST",
          firstName: quickCreate.firstName.trim(),
          lastName: quickCreate.lastName.trim() || undefined,
          communications,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        handleSelect(created)
      } else {
        const err = await res.json()
        setError(err.error || "Couldn't create the profile. Try again.")
      }
    } catch {
      setError("Couldn't create the profile. Try again.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              {...INPUT_SEARCH}
              autoFocus
              className="pl-8"
              placeholder="Search by first name, last name, email, or address..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="border rounded-md max-h-64 overflow-y-auto divide-y">
            {loading ? (
              <InlineLoading lines={3} className="p-3" label="Searching" />
            ) : visibleResults.length === 0 ? (
              <EmptyState size="inline" className="p-3" title="No matching profiles found" />
            ) : (
              visibleResults.map(p => {
                const email = p.communications?.find(c => c.type === "EMAIL")?.value
                return (
                  <button
                    type="button"
                    key={p.upid}
                    onClick={() => handleSelect(p)}
                    className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-2 max-sm:flex-col max-sm:items-start max-sm:gap-0.5 pointer-coarse:min-h-11"
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      {p.firstName} {p.lastName || ""}
                      {p.vipLevel && <Star className="h-3.5 w-3.5 text-warning fill-none shrink-0" />}
                    </span>
                    {email && <span className="text-xs text-muted-foreground max-sm:break-all">{email}</span>}
                  </button>
                )
              })
            )}
          </div>

          {!showQuickCreate ? (
            <Button type="button" variant="outline" className="border-dashed max-sm:h-auto max-sm:py-2 max-sm:whitespace-normal" onClick={openQuickCreate}>
              <UserPlus className="h-4 w-4 mr-2" /> Can&apos;t find them? Quick-create a profile
            </Button>
          ) : (
            <form onSubmit={handleQuickCreate} className="border rounded-md p-3 flex flex-col gap-3 bg-muted/40">
              <p className="text-xs font-medium text-muted-foreground">New guest profile</p>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">First name <span className="text-destructive">*</span></Label>
                  <Input value={quickCreate.firstName} onChange={e => setQuickCreate(p => ({ ...p, firstName: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Last name</Label>
                  <Input value={quickCreate.lastName} onChange={e => setQuickCreate(p => ({ ...p, lastName: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input {...INPUT_EMAIL} value={quickCreate.email} onChange={e => setQuickCreate(p => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Phone</Label>
                  <Input {...INPUT_PHONE} value={quickCreate.phone} onChange={e => setQuickCreate(p => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowQuickCreate(false)}>Cancel</Button>
                <SubmitButton size="sm" pending={creating} pendingLabel="Creating…" disabled={!quickCreate.firstName.trim()}>
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Create & select
                </SubmitButton>
              </div>
            </form>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
