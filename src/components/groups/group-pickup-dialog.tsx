"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useProperty } from "@/components/providers/property-provider"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { DatePicker } from "@/components/ui/date-picker"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Switch } from "@/components/ui/switch"
import { Plus } from "@/components/icons"
import { addDays, subDays, parseISO, format } from "date-fns"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"
import { SubmitButton } from "@/components/ui/submit-button"

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

// APP STANDARD 001: Zod + React Hook Form, inline real-time errors. The rules are the
// pickup endpoint's own (POST /api/groups/[id]/pickup): guest first/last name, room type
// and both dates are required, and check-out must be after check-in. Rate/meal plan are
// optional (blank = property default / room only). Values are sent untrimmed, as before.
const requiredText = (message: string) => z.string().refine((v) => v.trim().length > 0, { message })

const pickupSchema = z
  .object({
    firstName: requiredText("First name is required"),
    lastName: requiredText("Last name is required"),
    roomTypeId: z.string().min(1, "Pick a room type"),
    ratePlanId: z.string(),
    mealPlanCode: z.string(),
    checkInDate: z.string().min(1, "Pick a check-in date"),
    checkOutDate: z.string().min(1, "Pick a check-out date"),
    billToMaster: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.checkInDate && v.checkOutDate && v.checkOutDate <= v.checkInDate) {
      ctx.addIssue({ code: "custom", path: ["checkOutDate"], message: "Check-out must be after check-in" })
    }
  })

type PickupValues = z.infer<typeof pickupSchema>

const pickupDefaults: PickupValues = {
  firstName: "",
  lastName: "",
  roomTypeId: "",
  ratePlanId: "",
  mealPlanCode: "",
  checkInDate: "",
  checkOutDate: "",
  // Group pickups bill the block's master folio by default; staff can opt a guest out.
  billToMaster: true,
}

// Always sent with these values (the dialog has no inputs for them) — same payload as before.
const FIXED_FIELDS = { email: "", phone: "", adults: "1" }

export function GroupPickupDialog({ groupId, onSaved, disabledReason, blockStart, blockEnd, roomTypeOptions }: GroupPickupDialogProps) {
  const { currentProperty } = useProperty()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [ratePlans, setRatePlans] = useState<any[]>([])
  const [mealPlans, setMealPlans] = useState<any[]>([])

  const form = useForm<PickupValues>({
    resolver: zodResolver(pickupSchema),
    mode: "onChange",
    defaultValues: pickupDefaults,
  })
  const checkInDate = form.watch("checkInDate")
  const billToMaster = form.watch("billToMaster")

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

  // Pickup dates must fall within the block window: check-in in [start, end-1],
  // check-out in [check-in+1, end].
  const dayAfter = (d: string) => format(addDays(parseISO(d), 1), "yyyy-MM-dd")
  const dayBefore = (d: string) => format(subDays(parseISO(d), 1), "yyyy-MM-dd")

  const onSubmit = async (values: PickupValues) => {
    setLoading(true)
    const { billToMaster: bill, ...fields } = values
    // Overbooking is allowed with confirmation (409 + requiresOverbookConfirm on the
    // first try, then resend with acknowledgeOverbook).
    const send = async (acknowledgeOverbook: boolean) => {
      const res = await fetch(`/api/groups/${groupId}/pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, ...FIXED_FIELDS, billToMaster: bill, acknowledgeOverbook })
      })
      if (res.ok) {
        form.reset(pickupDefaults)
        setOpen(false)
        toast.success(`Room picked up for ${fields.firstName.trim()} ${fields.lastName.trim()}`.trim())
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
      toast.error(err.error || "Couldn't create the pickup. Try again.")
    }
    try {
      await send(false)
    } catch (e) {
      console.error(e)
      toast.error("Couldn't create the pickup. Try again.")
    } finally {
      setLoading(false)
    }
  }

  // Esc, the overlay, X and Cancel all come through here — a filled-in pickup is not
  // thrown away without asking (DESKTOP_PLAN D11). Discarding starts the next one fresh.
  const requestClose = async () => {
    if (loading) return
    if (form.formState.isDirty) {
      if (!(await confirm({ title: "Discard changes?", confirmLabel: "Discard", destructive: true }))) return
      form.reset(pickupDefaults)
    }
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : requestClose())}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2" disabled={!!disabledReason} title={disabledReason}>
          <Plus className="w-4 h-4" />
          Pickup room
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Pickup room from block</DialogTitle>
          <DialogDescription>
            Create a reservation for a guest under this Group Block.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input autoComplete="given-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input autoComplete="family-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <FormField
                control={form.control}
                name="checkInDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Check-in</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value}
                        minDate={blockStart || undefined}
                        maxDate={blockEnd ? dayBefore(blockEnd) : undefined}
                        onChange={(v) => {
                          // Drop a now-invalid check-out (on/before the new arrival, or past the block).
                          const co = form.getValues("checkOutDate")
                          const keepCo = co && v && co > v && (!blockEnd || co <= blockEnd)
                          field.onChange(v)
                          if (co && !keepCo) form.setValue("checkOutDate", "", { shouldValidate: true })
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="checkOutDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Check-out</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value}
                        minDate={checkInDate ? dayAfter(checkInDate) : blockStart ? dayAfter(blockStart) : undefined}
                        maxDate={blockEnd || undefined}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="roomTypeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Room type</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      value={field.value}
                      onChange={(v) => field.onChange(v ?? "")}
                      placeholder="Select room type"
                      options={roomTypeList.map((rt) => ({ label: `${rt.name} (${rt.code})`, value: rt.id }))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <FormField
                control={form.control}
                name="ratePlanId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate plan</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? "")}
                        placeholder="Property default"
                        options={ratePlans.map((rp) => ({ label: `${rp.code} — ${rp.name}`, value: rp.id }))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mealPlanCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Meal plan</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? "")}
                        placeholder="None (room only)"
                        options={mealPlans.map((mp) => ({ label: `${mp.code} — ${mp.name}`, value: mp.code }))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="billToMaster"
              render={({ field }) => (
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="pr-3">
                    <Label className="text-sm">Bill to group master folio</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {billToMaster ? "Charges route to the block's master folio." : "This guest settles their own folio."}
                    </p>
                  </div>
                  <Switch checked={field.value} onCheckedChange={(checked) => field.onChange(!!checked)} />
                </div>
              )}
            />

            <DialogFooter className="pt-4">
              <Button variant="outline" type="button" onClick={requestClose} disabled={loading}>Cancel</Button>
              <SubmitButton pending={loading} pendingLabel="Creating…">Create pickup</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
