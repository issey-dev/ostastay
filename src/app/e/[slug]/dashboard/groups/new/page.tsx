"use client"

import { useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { useRouter, useParams } from "next/navigation"
import { Save, ArrowLeft } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { GroupRoomHoldsEditor, type RoomHold } from "@/components/groups/group-room-holds-editor"
import { GROUP_START_STATUSES, GROUP_STATUS_LABEL } from "@/lib/group-status"
import Link from "next/link"
import { toast } from "@/lib/toast"

export default function NewGroupBlock() {
  const { currentProperty } = useProperty()
  const router = useRouter()
  const { slug } = useParams<{ slug: string }>()
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    startDate: "",
    endDate: "",
    cutoffDate: "",
    status: "TENTATIVE",
  })
  const [roomHolds, setRoomHolds] = useState<RoomHold[]>([])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentProperty) return
    setLoading(true)

    try {
      const res = await fetch(`/api/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          roomHolds: roomHolds.filter((h) => h.roomTypeId && h.quantity > 0),
          propertyId: currentProperty.id
        })
      })

      if (res.ok) {
        router.push(`/e/${slug}/dashboard/groups`)
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to create group")
      }
    } catch (error) {
      console.error(error)
      toast.error("An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href={`/e/${slug}/dashboard/groups`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">New Group Block</h2>
          <p className="text-muted-foreground">Reserve inventory for an upcoming event or corporate group.</p>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-elevation-1 border border-border p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="code">Group Code</Label>
              <Input 
                id="code" 
                name="code" 
                placeholder="e.g., SMITHWED26" 
                required 
                value={formData.code}
                onChange={handleChange}
                className="uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Group Name</Label>
              <Input 
                id="name" 
                name="name" 
                placeholder="e.g., Smith Wedding" 
                required 
                value={formData.name}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <DatePicker
                value={formData.startDate}
                onChange={(v) => setFormData({ ...formData, startDate: v })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <DatePicker
                value={formData.endDate}
                onChange={(v) => setFormData({ ...formData, endDate: v })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Status</Label>
              <SearchableSelect
                value={formData.status}
                onChange={(v) => setFormData({ ...formData, status: v ?? "TENTATIVE" })}
                placeholder="Status"
                options={GROUP_START_STATUSES.map((s) => ({ label: GROUP_STATUS_LABEL[s], value: s }))}
              />
              <p className="text-xs text-muted-foreground">A block starts Tentative or Definite.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cutoffDate">Cutoff Date (Optional)</Label>
              <DatePicker
                value={formData.cutoffDate}
                onChange={(v) => setFormData({ ...formData, cutoffDate: v })}
              />
              <p className="text-xs text-muted-foreground">Unreserved held rooms are released after this date.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Rooms to Hold (by type)</Label>
            <GroupRoomHoldsEditor
              propertyId={currentProperty?.id ?? ""}
              value={roomHolds}
              onChange={setRoomHolds}
              startDate={formData.startDate || undefined}
              endDate={formData.endDate || undefined}
            />
            <p className="text-xs text-muted-foreground">Held rooms are subtracted from availability until picked up or released at cutoff.</p>
          </div>

          <div className="pt-6 border-t flex justify-end gap-3">
            <Link href={`/e/${slug}/dashboard/groups`}>
              <Button variant="outline" type="button">Cancel</Button>
            </Link>
            <Button type="submit" disabled={loading}>
              <Save className="w-4 h-4 mr-2" />
              {loading ? "Creating..." : "Create Group Block"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
