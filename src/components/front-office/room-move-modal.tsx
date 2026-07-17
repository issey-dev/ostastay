import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Input } from "@/components/ui/input"

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

export function RoomMoveModal({ isOpen, onClose, reservationId, currentRoomNumber, currentRoomType, checkInDate, checkOutDate, propertyId }: RoomMoveModalProps) {
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [availableRooms, setAvailableRooms] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string>("")
  const [selectedRoomId, setSelectedRoomId] = useState<string>("")
  const [reason, setReason] = useState<string>("")

  // Fetch Room Types when opened
  useEffect(() => {
    if (isOpen) {
      setLoading(true)
      setError(null)
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
    } else {
      // Reset state when closed
      setSelectedRoomTypeId("")
      setSelectedRoomId("")
      setReason("")
      setAvailableRooms([])
    }
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

  const handleMove = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reservationId || !selectedRoomId || !selectedRoomTypeId || !reason) return

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/reservations/${reservationId}/room-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newRoomId: selectedRoomId,
          newRoomTypeId: selectedRoomTypeId,
          reason
        })
      })

      if (res.ok) {
        onClose()
      } else {
        const data = await res.json()
        setError(data.error || "Failed to move room")
      }
    } catch (e) {
      setError("An unexpected error occurred.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleMove}>
          <DialogHeader>
            <DialogTitle>Move Room</DialogTitle>
            <DialogDescription>
              Move the guest to a different room. The current room ({currentRoomNumber}) will be marked as DIRTY.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="bg-destructive-muted text-destructive p-3 rounded-md text-sm my-4">
              {error}
            </div>
          )}

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

            <div className="grid gap-2 mt-2">
              <Label>New Room Type <span className="text-destructive">*</span></Label>
              <Select required value={selectedRoomTypeId} onValueChange={(v) => { setSelectedRoomTypeId(v ?? ""); setSelectedRoomId(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select New Room Type">
                    {(() => {
                      const rt = roomTypes.find(r => r.id === selectedRoomTypeId)
                      return rt ? `${rt.name} (${rt.code})` : undefined
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {loading ? (
                    <SelectItem value="loading" disabled>Loading...</SelectItem>
                  ) : roomTypes.length === 0 ? (
                    <SelectItem value="none" disabled>No room types found</SelectItem>
                  ) : (
                    roomTypes.map(rt => (
                      <SelectItem key={rt.id} value={rt.id}>
                        {rt.name} ({rt.code})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>New Room <span className="text-destructive">*</span></Label>
              <SearchableSelect
                required
                value={selectedRoomId}
                onChange={setSelectedRoomId}
                placeholder={selectedRoomTypeId ? "Select Room" : "Select Room Type First"}
                options={availableRooms.map(rm => ({
                  value: rm.id,
                  label: `Room ${rm.roomNumber}`
                }))}
              />
            </div>

            <div className="grid gap-2">
              <Label>Reason for Move <span className="text-destructive">*</span></Label>
              <Input 
                required 
                placeholder="e.g. A/C Broken, Guest Request, Maintenance" 
                value={reason} 
                onChange={e => setReason(e.target.value)} 
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting || !selectedRoomId || !selectedRoomTypeId || !reason}>
              {submitting ? "Moving..." : "Confirm Move"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
