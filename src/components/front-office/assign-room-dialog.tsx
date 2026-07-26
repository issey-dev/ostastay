"use client"

import { useState, useEffect } from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { toast } from "@/lib/toast"

type AssignRoomDialogProps = {
  isOpen: boolean
  onClose: () => void
  reservationId: string | null
  // The reservation's room-assignment (segment) to attach a physical room to.
  assignmentId: string | null
  roomTypeId: string | null
  roomTypeName?: string
  checkInDate?: string
  checkOutDate?: string
  propertyId: string
  onAssigned?: (message: string) => void
}

// APP STANDARD 001: Zod + React Hook Form. A single required field — the room —
// since the room type is already fixed by the booking.
const schema = z.object({ roomId: z.string().min(1, "Select a room.") })
type FormValues = z.infer<typeof schema>

// Assigns a physical room to an arrival that's still TBA, WITHOUT checking the guest
// in. Reuses the same reassign endpoint the check-in wizard's room step uses.
export function AssignRoomDialog({
  isOpen, onClose, reservationId, assignmentId, roomTypeId, roomTypeName, checkInDate, checkOutDate, propertyId, onAssigned,
}: AssignRoomDialogProps) {
  const [availableRooms, setAvailableRooms] = useState<{ id: string; roomNumber: string }[]>([])
  const [loading, setLoading] = useState(false)

  const form = useForm<FormValues>({ resolver: zodResolver(schema), mode: "onChange", defaultValues: { roomId: "" } })

  // Load rooms of the booking's room type that are free for the stay dates.
  useEffect(() => {
    if (isOpen && roomTypeId && checkInDate && checkOutDate) {
      form.reset({ roomId: "" })
      setAvailableRooms([])
      setLoading(true)
      const excludeParam = reservationId ? `&excludeReservationId=${reservationId}` : ""
      fetch(`/api/rooms/available?propertyId=${propertyId}&roomTypeId=${roomTypeId}&checkInDate=${checkInDate}&checkOutDate=${checkOutDate}${excludeParam}`)
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setAvailableRooms(data) })
        .catch(console.error)
        .finally(() => setLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, roomTypeId, checkInDate, checkOutDate, reservationId, propertyId])

  const onSubmit = async (values: FormValues) => {
    if (!assignmentId) return
    try {
      const res = await fetch(`/api/reservations/assignments/${assignmentId}/reassign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: values.roomId }),
      })
      const data = await res.json()
      if (res.ok) {
        const room = availableRooms.find((r) => r.id === values.roomId)
        onAssigned?.(`Room ${room?.roomNumber ?? ""} assigned.`)
        onClose()
      } else {
        toast.error(data.error || "Failed to assign room.")
      }
    } catch {
      toast.error("An unexpected error occurred.")
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[450px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Assign Room</DialogTitle>
              <DialogDescription>
                Assign an available {roomTypeName || "room"} to this arrival. This does not check the guest in.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {roomTypeName && (
                <div className="grid gap-2">
                  <Label>Room Type</Label>
                  <Input disabled value={roomTypeName} className="bg-muted" />
                </div>
              )}
              <FormField control={form.control} name="roomId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Room <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <SearchableSelect
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={loading ? "Loading rooms..." : availableRooms.length ? "Select Room" : "No rooms available"}
                      options={availableRooms.map((rm) => ({ value: rm.id, label: `Room ${rm.roomNumber}` }))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={form.formState.isSubmitting}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting || !availableRooms.length}>
                {form.formState.isSubmitting ? "Assigning..." : "Assign Room"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
