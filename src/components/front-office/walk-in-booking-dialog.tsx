"use client"

import { useEffect, useMemo, useState } from "react"
import { addDays, format, startOfDay } from "date-fns"
import type { DateRange } from "react-day-picker"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Loader2, UserPlus } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"

type WalkInBookingDialogProps = {
  propertyId: string
  isOpen: boolean
  onClose: () => void
  onDone: (result: { title: string; message: string; isError?: boolean }) => void
  /** "walkIn" (default) checks the guest in immediately after booking; "book" just books. */
  mode?: "walkIn" | "book"
  /** Prefill (e.g. from a tape-chart cell click): room type, room, and arrival date. */
  initial?: { roomTypeId?: string; roomId?: string; checkInDate?: string }
}

const toIsoDate = (d: Date) => format(d, "yyyy-MM-dd")

// APP STANDARD 001: Zod + React Hook Form with inline, real-time validation. Guest is
// required either as a picked profile (guestId) or a quick-create first name, resolved
// conditionally in superRefine based on newGuestMode. Dates must carry both ends.
const walkInSchema = z
  .object({
    guestId: z.string(),
    newGuestMode: z.boolean(),
    newFirstName: z.string(),
    newLastName: z.string(),
    dates: z.custom<DateRange | undefined>().refine((d) => !!d?.from && !!d?.to, "Pick the stay dates."),
    roomTypeId: z.string().min(1, "Select a room type."),
    roomId: z.string().min(1, "Select an available room."),
    ratePlanId: z.string().min(1, "Select a rate plan."),
    adults: z.string(),
    children: z.string(),
  })
  .superRefine((val, ctx) => {
    if (!val.newGuestMode && !val.guestId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Select a guest or create a new one.", path: ["guestId"] })
    }
    if (val.newGuestMode && !val.newFirstName.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the guest's first name.", path: ["newFirstName"] })
    }
  })
type WalkInFormValues = z.infer<typeof walkInSchema>

// A compressed booking flow: pick or quick-create the guest, confirm dates/room/
// rate, and book — one dialog instead of the full multi-segment booking form.
// Walk-in mode additionally checks the guest straight in; book mode (used by the
// tape chart's empty-cell click) leaves the booking RESERVED.
export function WalkInBookingDialog({ propertyId, isOpen, onClose, onDone, mode = "walkIn", initial }: WalkInBookingDialogProps) {
  const confirm = useConfirm()
  const [profiles, setProfiles] = useState<any[]>([])
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [ratePlans, setRatePlans] = useState<any[]>([])
  const [availableRooms, setAvailableRooms] = useState<any[]>([])

  const form = useForm<WalkInFormValues>({
    resolver: zodResolver(walkInSchema),
    mode: "onChange",
    defaultValues: {
      guestId: "",
      newGuestMode: false,
      newFirstName: "",
      newLastName: "",
      dates: undefined,
      roomTypeId: "",
      roomId: "",
      ratePlanId: "",
      adults: "1",
      children: "0",
    },
  })

  const newGuestMode = form.watch("newGuestMode")
  const roomTypeId = form.watch("roomTypeId")
  const dates = form.watch("dates")

  useEffect(() => {
    if (!isOpen) return
    const start = initial?.checkInDate ? startOfDay(new Date(initial.checkInDate)) : startOfDay(new Date())
    form.reset({
      guestId: "",
      newGuestMode: false,
      newFirstName: "",
      newLastName: "",
      dates: { from: start, to: addDays(start, 1) },
      roomTypeId: initial?.roomTypeId ?? "",
      roomId: initial?.roomId ?? "",
      ratePlanId: "",
      adults: "1",
      children: "0",
    })

    fetch(`/api/profiles?profileType=GUEST`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setProfiles(d) })
      .catch(console.error)
    fetch(`/api/room-types?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setRoomTypes(d.filter((rt: any) => rt.isActive !== false && !rt.isPseudo)) })
      .catch(console.error)
    fetch(`/api/rate-plans?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setRatePlans(d.filter((rp: any) => rp.isActive !== false)) })
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, propertyId])

  // Available rooms refresh whenever the room type or dates change.
  useEffect(() => {
    if (!isOpen || !roomTypeId || !dates?.from || !dates?.to) { setAvailableRooms([]); return }
    const params = new URLSearchParams({
      propertyId,
      roomTypeId,
      checkInDate: toIsoDate(dates.from),
      checkOutDate: toIsoDate(dates.to),
    })
    fetch(`/api/rooms/available?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          setAvailableRooms(d)
          const prev = form.getValues("roomId")
          if (!d.some((room: any) => room.id === prev)) form.setValue("roomId", "", { shouldValidate: true })
        }
      })
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, roomTypeId, dates?.from?.getTime(), dates?.to?.getTime()])

  const guestOptions = useMemo(
    () =>
      profiles.map((p) => ({
        label: `${p.firstName} ${p.lastName ?? ""}`.trim(),
        value: p.upid,
      })),
    [profiles]
  )

  const onSubmit = async (values: WalkInFormValues) => {
    if (!values.dates?.from || !values.dates?.to) return

    try {
      // 1. Quick-create the guest profile if needed.
      let primaryGuestId = values.guestId
      if (values.newGuestMode) {
        const profileRes = await fetch(`/api/profiles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileType: "GUEST",
            firstName: values.newFirstName.trim(),
            lastName: values.newLastName.trim() || null,
            originPropertyId: propertyId,
          }),
        })
        const profileData = await profileRes.json()
        if (!profileRes.ok) {
          toast.error(profileData.error || "Failed to create the guest profile.")
          return
        }
        primaryGuestId = profileData.upid
      }

      // 2. Create the reservation (single segment, room pre-picked). Overbooking is
      // allowed with confirmation (409 + requiresOverbookConfirm → confirm → resend).
      const createReservation = (acknowledgeOverbook: boolean) =>
        fetch(`/api/reservations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            propertyId,
            primaryGuestId,
            checkInDate: toIsoDate(values.dates!.from!),
            checkOutDate: toIsoDate(values.dates!.to!),
            adults: parseInt(values.adults) || 1,
            children: parseInt(values.children) || 0,
            roomTypeId: values.roomTypeId,
            roomId: values.roomId,
            ratePlanId: values.ratePlanId,
            acknowledgeOverbook,
          }),
        })
      let resRes = await createReservation(false)
      let resData = await resRes.json()
      if (!resRes.ok && resRes.status === 409 && resData.requiresOverbookConfirm) {
        const ok = await confirm({
          title: "Overbook this room type?",
          description: `${resData.error}. This will oversell the room type — proceed anyway?`,
          confirmLabel: "Overbook",
        })
        if (!ok) return
        resRes = await createReservation(true)
        resData = await resRes.json()
      }
      if (!resRes.ok) {
        toast.error(resData.error || "Failed to create the reservation.")
        return
      }

      if (mode === "book") {
        onClose()
        onDone({
          title: "Booking Created",
          message:
            `${resData.confirmationNo} booked.` +
            (resData.capacityWarning ? ` ${resData.capacityWarning}` : ""),
        })
        return
      }

      // 3. Immediate check-in — that's the point of a walk-in.
      const checkIn = await fetch(`/api/reservations/${resData.id}/check-in`, { method: "POST" })
      const checkInData = await checkIn.json()

      onClose()
      if (checkIn.ok) {
        onDone({
          title: "Walk-in Checked In",
          message:
            `${resData.confirmationNo} created and checked in.` +
            (checkInData.roomWarning ? ` Warning: ${checkInData.roomWarning}` : "") +
            (resData.capacityWarning ? ` ${resData.capacityWarning}` : ""),
        })
      } else {
        onDone({
          title: "Booked, Check-in Failed",
          message: `${resData.confirmationNo} was created but check-in failed: ${checkInData.error || "unknown error"}. Check them in from the arrivals list.`,
          isError: true,
        })
      }
    } catch {
      toast.error("An unexpected error occurred.")
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "book" ? "Quick Booking" : "Walk-in Booking"}</DialogTitle>
          <DialogDescription>
            {mode === "book"
              ? "Create a booking for the selected room and dates."
              : "Create a booking and check the guest straight in."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Guest</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const next = !newGuestMode
                      form.setValue("newGuestMode", next, { shouldValidate: true })
                      form.clearErrors(["guestId", "newFirstName"])
                    }}
                  >
                    <UserPlus className="w-3.5 h-3.5 mr-1" />
                    {newGuestMode ? "Pick existing guest" : "New guest"}
                  </Button>
                </div>
                {newGuestMode ? (
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="newFirstName" render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="First name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="newLastName" render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="Last name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                ) : (
                  <FormField control={form.control} name="guestId" render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <SearchableSelect
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Select guest..."
                          options={guestOptions}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>

              <FormField control={form.control} name="dates" render={({ field }) => (
                <FormItem>
                  <FormLabel>Stay Dates</FormLabel>
                  <FormControl>
                    <DateRangePicker value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="roomTypeId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Room Type</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value}
                        onChange={(v: string) => { field.onChange(v); form.setValue("roomId", "", { shouldValidate: true }) }}
                        placeholder="Room type..."
                        options={roomTypes.map((rt) => ({ label: rt.name, value: rt.id }))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="roomId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Room</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value}
                        onChange={field.onChange}
                        placeholder={roomTypeId ? (availableRooms.length ? "Select room..." : "No rooms available") : "Pick a type first"}
                        options={availableRooms.map((r) => ({
                          label: `${r.roomNumber} — ${r.status.replace(/_/g, " ").toLowerCase()}`,
                          value: r.id,
                        }))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <FormField control={form.control} name="ratePlanId" render={({ field }) => (
                  <FormItem className="col-span-1">
                    <FormLabel>Rate Plan</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Rate..."
                        options={ratePlans.map((rp) => ({ label: `${rp.code} — ${rp.name}`, value: rp.id }))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="adults" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Adults</FormLabel>
                    <FormControl>
                      <Input type="number" min="1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="children" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Children</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={form.formState.isSubmitting}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === "book" ? "Create Booking" : "Book & Check In"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
