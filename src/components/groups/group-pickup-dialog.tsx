"use client"

import { useState, useEffect } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Switch } from "@/components/ui/switch"
import { Plus } from "@/components/icons"
import { addDays, subDays, parseISO, format } from "date-fns"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"

type GroupPickupDialogProps = {
  groupId: string
  onSaved: () => void
  disabledReason?: string
  // The block's date span (yyyy-MM-dd) — pickup dates are constrained to it.
  blockStart?: string
  blockEnd?: string
  // The block's held room types — the only ones a pickup may choose. Falls back to all
  // property room types when empty (legacy blocks with no per-type holds).
  roomTypeOptions?: { id: string; name: string; code: string }[]
}

export function GroupPickupDialog({ groupId, onSaved, disabledReason, blockStart, blockEnd, roomTypeOptions }: GroupPickupDialogProps) {
  const { currentProperty } = useProperty()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [ratePlans, setRatePlans] = useState<any[]>([])
  const [mealPlans, setMealPlans] = useState<any[]>([])
  // Group pickups bill the block's master folio by default; staff can opt a guest out.
  const [billToMaster, setBillToMaster] = useState(true)

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    roomTypeId: "",
    ratePlanId: "",
    mealPlanCode: "",
    checkInDate: "",
    checkOutDate: "",
    adults: "1"
  })

  // Room types offered = the block's held types (roomTypeOptions); only fall back to
  // fetching all property types when the block has no per-type holds (legacy).
  const usesBlockTypes = !!(roomTypeOptions && roomTypeOptions.length)
  const roomTypeList = usesBlockTypes ? roomTypeOptions! : roomTypes

  useEffect(() => {
    if (!open || !currentProperty) return
    if (!usesBlockTypes && roomTypes.length === 0) {
      fetch(`/api/room-types?propertyId=${currentProperty.id}`)
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setRoomTypes(data) })
        .catch(console.error)
    }
    if (ratePlans.length === 0) {
      fetch(`/api/rate-plans?propertyId=${currentProperty.id}`)
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setRatePlans(data.filter((rp: any) => rp.isActive !== false)) })
        .catch(console.error)
    }
    if (mealPlans.length === 0) {
      fetch(`/api/meal-plans?propertyId=${currentProperty.id}`)
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setMealPlans(data.filter((mp: any) => mp.isActive !== false)) })
        .catch(console.error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentProperty, usesBlockTypes])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  // Pickup dates must fall within the block window: check-in in [start, end-1],
  // check-out in [check-in+1, end].
  const dayAfter = (d: string) => format(addDays(parseISO(d), 1), "yyyy-MM-dd")
  const dayBefore = (d: string) => format(subDays(parseISO(d), 1), "yyyy-MM-dd")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    // Overbooking is allowed with confirmation (409 + requiresOverbookConfirm on the
    // first try, then resend with acknowledgeOverbook).
    const send = async (acknowledgeOverbook: boolean) => {
      const res = await fetch(`/api/groups/${groupId}/pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, billToMaster, acknowledgeOverbook })
      })
      if (res.ok) {
        setOpen(false)
        onSaved()
        return
      }
      const err = await res.json()
      if (res.status === 409 && err.requiresOverbookConfirm) {
        setLoading(false)
        const ok = await confirm({
          title: "Overbook?",
          description: `${err.error} Proceed anyway?`,
          confirmLabel: "Overbook",
        })
        if (ok) { setLoading(true); await send(true) }
        return
      }
      toast.error(err.error || "Failed to create pickup reservation")
    }
    try {
      await send(false)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2" disabled={!!disabledReason} title={disabledReason}>
          <Plus className="w-4 h-4" />
          Pickup Room
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pickup Room from Block</DialogTitle>
          <DialogDescription>
            Create a reservation for a guest under this Group Block.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input id="firstName" name="firstName" required value={formData.firstName} onChange={handleChange} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" name="lastName" required value={formData.lastName} onChange={handleChange} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="checkInDate">Check-in</Label>
              <DatePicker
                value={formData.checkInDate}
                minDate={blockStart || undefined}
                maxDate={blockEnd ? dayBefore(blockEnd) : undefined}
                onChange={(v) =>
                  setFormData((p) => {
                    // Drop a now-invalid check-out (on/before the new arrival, or past the block).
                    const keepCo = p.checkOutDate && v && p.checkOutDate > v && (!blockEnd || p.checkOutDate <= blockEnd)
                    return { ...p, checkInDate: v, checkOutDate: keepCo ? p.checkOutDate : "" }
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="checkOutDate">Check-out</Label>
              <DatePicker
                value={formData.checkOutDate}
                minDate={formData.checkInDate ? dayAfter(formData.checkInDate) : blockStart ? dayAfter(blockStart) : undefined}
                maxDate={blockEnd || undefined}
                onChange={(v) => setFormData((p) => ({ ...p, checkOutDate: v }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Room Type</Label>
            <SearchableSelect
              value={formData.roomTypeId}
              onChange={(v) => setFormData((p) => ({ ...p, roomTypeId: v ?? "" }))}
              placeholder="Select room type"
              options={roomTypeList.map((rt) => ({ label: `${rt.name} (${rt.code})`, value: rt.id }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Rate Plan</Label>
              <SearchableSelect
                value={formData.ratePlanId}
                onChange={(v) => setFormData((p) => ({ ...p, ratePlanId: v ?? "" }))}
                placeholder="Property default"
                options={ratePlans.map((rp) => ({ label: `${rp.code} — ${rp.name}`, value: rp.id }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Meal Plan</Label>
              <SearchableSelect
                value={formData.mealPlanCode}
                onChange={(v) => setFormData((p) => ({ ...p, mealPlanCode: v ?? "" }))}
                placeholder="None (Room Only)"
                options={mealPlans.map((mp) => ({ label: `${mp.code} — ${mp.name}`, value: mp.code }))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="pr-3">
              <Label className="text-sm">Bill to group master folio</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {billToMaster ? "Charges route to the block's master folio." : "This guest settles their own folio."}
              </p>
            </div>
            <Switch checked={billToMaster} onCheckedChange={setBillToMaster} />
          </div>

          <DialogFooter className="pt-4">
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="" disabled={loading}>
              {loading ? "Saving..." : "Create Pickup"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
