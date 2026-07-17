"use client"

import { useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { useRouter, useParams } from "next/navigation"
import { Users, Save, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"

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
    totalRoomsHeld: "10"
  })

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
          propertyId: currentProperty.id
        })
      })

      if (res.ok) {
        router.push(`/e/${slug}/dashboard/groups`)
      } else {
        const err = await res.json()
        alert(err.error || "Failed to create group")
      }
    } catch (error) {
      console.error(error)
      alert("An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href={`/e/${slug}/dashboard/groups`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            New Group Block
          </h1>
          <p className="text-muted-foreground mt-1">Reserve inventory for an upcoming event or corporate group.</p>
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
              <Input 
                id="startDate" 
                name="startDate" 
                type="date" 
                required 
                value={formData.startDate}
                onChange={handleChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input 
                id="endDate" 
                name="endDate" 
                type="date" 
                required 
                value={formData.endDate}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="totalRoomsHeld">Total Rooms to Hold</Label>
              <Input 
                id="totalRoomsHeld" 
                name="totalRoomsHeld" 
                type="number" 
                min="1"
                required 
                value={formData.totalRoomsHeld}
                onChange={handleChange}
              />
              <p className="text-xs text-muted-foreground">Inventory will be subtracted from availability.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cutoffDate">Cutoff Date (Optional)</Label>
              <Input 
                id="cutoffDate" 
                name="cutoffDate" 
                type="date" 
                value={formData.cutoffDate}
                onChange={handleChange}
              />
              <p className="text-xs text-muted-foreground">Unreserved rooms will be released after this date.</p>
            </div>
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
