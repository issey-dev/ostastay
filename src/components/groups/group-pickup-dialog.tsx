"use client"

import { useState, useEffect } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus } from "lucide-react"

export function GroupPickupDialog({ groupId, onSaved }: { groupId: string, onSaved: () => void }) {
  const { currentProperty } = useProperty()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [roomTypes, setRoomTypes] = useState<any[]>([])

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    roomTypeId: "",
    checkInDate: "",
    checkOutDate: "",
    adults: "1"
  })

  useEffect(() => {
    if (open && currentProperty && roomTypes.length === 0) {
      fetch(`/api/room-types?propertyId=${currentProperty.id}`)
        .then(res => res.json())
        .then(data => setRoomTypes(data))
        .catch(console.error)
    }
  }, [open, currentProperty])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch(`/api/groups/${groupId}/pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      })

      if (res.ok) {
        setOpen(false)
        onSaved()
      } else {
        const err = await res.json()
        alert(err.error || "Failed to create pickup reservation")
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Pickup Room
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
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
              <Input type="date" id="checkInDate" name="checkInDate" required value={formData.checkInDate} onChange={handleChange} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="checkOutDate">Check-out</Label>
              <Input type="date" id="checkOutDate" name="checkOutDate" required value={formData.checkOutDate} onChange={handleChange} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Room Type</Label>
            <Select value={formData.roomTypeId} onValueChange={(val) => setFormData({ ...formData, roomTypeId: val ?? "" })}>
              <SelectTrigger>
                <SelectValue placeholder="Select room type" />
              </SelectTrigger>
              <SelectContent>
                {roomTypes.map((rt) => (
                  <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
