"use client"

import { useState, useEffect } from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { toast } from "@/lib/toast"

type RoomMoveModalProps = {
  isOpen: boolean
  onClose: () => void
  reservationId: string | null
  currentRoomNumber?: string
  currentRoomType?: string
  checkInDate?: string
  checkOutDate?: string
  propertyId: string
}

// APP STANDARD 001: Zod + React Hook Form with inline, real-time validation. The three
// user-entered fields (new room type, new room, reason) are all required.
const roomMoveSchema = z.object({
  roomTypeId: z.string().min(1, "Select a room type."),
  roomId: z.string().min(1, "Select a room."),
  reason: z.string().min(1, "Enter a reason for the move."),
})
type RoomMoveFormValues = z.infer<typeof roomMoveSchema>

export function RoomMoveModal({ isOpen, onClose, reservationId, currentRoomNumber, currentRoomType, checkInDate, checkOutDate, propertyId }: RoomMoveModalProps) {
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [availableRooms, setAvailableRooms] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  // Rate preview for a move to a different room type — current ("keep") vs new rate.
  const [rateInfo, setRateInfo] = useState<{ sameType: boolean; keepRate: number; newRate: number; remainingNights: number } | null>(null)
  const [rateLoading, setRateLoading] = useState(false)
  const [rateMode, setRateMode] = useState<"keep" | "new">("new")

  const form = useForm<RoomMoveFormValues>({
    resolver: zodResolver(roomMoveSchema),
    mode: "onChange",
    defaultValues: { roomTypeId: "", roomId: "", reason: "" },
  })

  const selectedRoomTypeId = form.watch("roomTypeId")

  // Fetch Room Types when opened
  useEffect(() => {
    if (isOpen) {
      form.reset({ roomTypeId: "", roomId: "", reason: "" })
      setAvailableRooms([])
      setRateInfo(null)
      setRateMode("new")
      setLoading(true)
      fetch(`/api/room-types?propertyId=${propertyId}`)
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) setRoomTypes(data)
          setLoading(false)
        })
        .catch(e => {
          console.error(e)
          setLoading(false)
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, propertyId])

  // Fetch Available Rooms when Room Type changes
  useEffect(() => {
    if (isOpen && selectedRoomTypeId && checkInDate && checkOutDate) {
      const excludeParam = reservationId ? `&excludeReservationId=${reservationId}` : ""
      fetch(`/api/rooms/available?propertyId=${propertyId}&roomTypeId=${selectedRoomTypeId}&checkInDate=${checkInDate}&checkOutDate=${checkOutDate}${excludeParam}`)
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) setAvailableRooms(data)
        })
        .catch(console.error)
    } else {
      setAvailableRooms([])
    }
  }, [selectedRoomTypeId, checkInDate, checkOutDate, reservationId, propertyId, isOpen])

  // Rate preview whenever a (different) room type is chosen — current vs new nightly rate.
  useEffect(() => {
    if (!isOpen || !reservationId || !selectedRoomTypeId) { setRateInfo(null); return }
    setRateLoading(true)
    setRateMode("new")
    fetch(`/api/reservations/${reservationId}/room-move-rate?newRoomTypeId=${selectedRoomTypeId}`)
      .then((r) => r.json())
      .then((d) => setRateInfo(d && typeof d.keepRate === "number" ? d : null))
      .catch(() => setRateInfo(null))
      .finally(() => setRateLoading(false))
  }, [isOpen, reservationId, selectedRoomTypeId])

  const onSubmit = async (values: RoomMoveFormValues) => {
    if (!reservationId) return
    try {
      const res = await fetch(`/api/reservations/${reservationId}/room-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newRoomId: values.roomId,
          newRoomTypeId: values.roomTypeId,
          reason: values.reason,
          // Only meaningful on a move to a different room type; ignored server-side otherwise.
          ...(rateInfo && !rateInfo.sameType ? { rateMode } : {}),
        })
      })

      if (res.ok) {
        onClose()
      } else {
        const data = await res.json()
        toast.error(data.error || "Failed to move room")
      }
    } catch {
      toast.error("An unexpected error occurred.")
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Move Room</DialogTitle>
              <DialogDescription>
                Move the guest to a different room. The current room ({currentRoomNumber}) will be marked as DIRTY.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Current Room Type</Label>
                  <Input disabled value={currentRoomType || ""} className="bg-muted" />
                </div>
                <div className="grid gap-2">
                  <Label>Current Room</Label>
                  <Input disabled value={currentRoomNumber || ""} className="bg-muted font-semibold" />
                </div>
              </div>

              <FormField control={form.control} name="roomTypeId" render={({ field }) => (
                <FormItem className="mt-2">
                  <FormLabel>New Room Type <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <SearchableSelect
                      value={field.value}
                      onChange={(v) => { field.onChange(v ?? ""); form.setValue("roomId", "", { shouldValidate: true }) }}
                      placeholder={loading ? "Loading..." : "Select New Room Type"}
                      options={roomTypes.map(rt => ({ value: rt.id, label: `${rt.name} (${rt.code})` }))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="roomId" render={({ field }) => (
                <FormItem>
                  <FormLabel>New Room <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <SearchableSelect
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={selectedRoomTypeId ? "Select Room" : "Select Room Type First"}
                      options={availableRooms.map(rm => ({
                        value: rm.id,
                        label: `Room ${rm.roomNumber}`
                      }))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {rateLoading && <p className="text-[11px] text-muted-foreground">Checking rates…</p>}
              {rateInfo && !rateInfo.sameType && (
                <div className="grid gap-2">
                  <Label>Rate <span className="text-destructive">*</span></Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRateMode("new")}
                      className={`rounded-md border p-3 text-left transition-colors ${rateMode === "new" ? "border-primary ring-1 ring-primary bg-primary/5" : "border-border hover:bg-muted"}`}
                    >
                      <div className="text-xs text-muted-foreground">Charge new rate</div>
                      <div className="text-lg font-semibold">${rateInfo.newRate.toFixed(2)}<span className="text-xs font-normal text-muted-foreground">/night</span></div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRateMode("keep")}
                      className={`rounded-md border p-3 text-left transition-colors ${rateMode === "keep" ? "border-primary ring-1 ring-primary bg-primary/5" : "border-border hover:bg-muted"}`}
                    >
                      <div className="text-xs text-muted-foreground">Keep current rate</div>
                      <div className="text-lg font-semibold">${rateInfo.keepRate.toFixed(2)}<span className="text-xs font-normal text-muted-foreground">/night</span></div>
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Applies to the remaining {rateInfo.remainingNights} night{rateInfo.remainingNights === 1 ? "" : "s"}.{" "}
                    {rateMode === "keep" ? "Billed as the current room type." : "Billed at the new room type's rate."}
                  </p>
                </div>
              )}

              <FormField control={form.control} name="reason" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for Move <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. A/C Broken, Guest Request, Maintenance"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={form.formState.isSubmitting}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Moving..." : "Confirm Move"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
