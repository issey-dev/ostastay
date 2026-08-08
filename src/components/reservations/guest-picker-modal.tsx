"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Star, Search, UserPlus, Loader2 } from "@/components/icons"

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
export function GuestPickerModal({ isOpen, onClose, enterpriseId, onSelect, excludeIds = [], title = "Select Guest" }: GuestPickerModalProps) {
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

  const handleQuickCreate = async () => {
    if (!quickCreate.firstName.trim()) return
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
        setError(err.error || "Failed to create profile")
      }
    } catch {
      setError("An unexpected error occurred.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-8"
              placeholder="Search by first name, last name, email, or address..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="border rounded-md max-h-64 overflow-y-auto divide-y">
            {loading ? (
              <p className="text-sm text-muted-foreground italic p-3">Searching...</p>
            ) : visibleResults.length === 0 ? (
              <p className="text-sm text-muted-foreground italic p-3">No matching profiles found.</p>
            ) : (
              visibleResults.map(p => {
                const email = p.communications?.find(c => c.type === "EMAIL")?.value
                return (
                  <button
                    type="button"
                    key={p.upid}
                    onClick={() => handleSelect(p)}
                    className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-2"
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      {p.firstName} {p.lastName || ""}
                      {p.vipLevel && <Star className="h-3.5 w-3.5 text-warning fill-none shrink-0" />}
                    </span>
                    {email && <span className="text-xs text-muted-foreground">{email}</span>}
                  </button>
                )
              })
            )}
          </div>

          {!showQuickCreate ? (
            <Button type="button" variant="outline" className="border-dashed" onClick={() => setShowQuickCreate(true)}>
              <UserPlus className="h-4 w-4 mr-2" /> Can&apos;t find them? Quick-create a profile
            </Button>
          ) : (
            <div className="border rounded-md p-3 flex flex-col gap-3 bg-muted/40">
              <p className="text-xs font-medium text-muted-foreground">New Guest Profile</p>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">First Name <span className="text-destructive">*</span></Label>
                  <Input value={quickCreate.firstName} onChange={e => setQuickCreate(p => ({ ...p, firstName: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Last Name</Label>
                  <Input value={quickCreate.lastName} onChange={e => setQuickCreate(p => ({ ...p, lastName: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={quickCreate.email} onChange={e => setQuickCreate(p => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Phone</Label>
                  <Input value={quickCreate.phone} onChange={e => setQuickCreate(p => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowQuickCreate(false)}>Cancel</Button>
                <Button type="button" size="sm" disabled={!quickCreate.firstName.trim() || creating} onClick={handleQuickCreate}>
                  {creating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5 mr-1.5" />}
                  {creating ? "Creating..." : "Create & Select"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
