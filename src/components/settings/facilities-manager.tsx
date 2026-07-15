"use client"

import { useState, useEffect } from "react"
import { RoomTypeManager } from "@/components/inventory/room-type-manager"
import { RoomManager } from "@/components/inventory/room-manager"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BedDouble, Building2 } from "lucide-react"

export function FacilitiesManager() {
  const [propertyId, setPropertyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/properties')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setPropertyId(data[0].id)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="py-12 text-center text-slate-500">Loading configurations...</div>
  }

  if (!propertyId) {
    return <div className="py-12 text-center text-rose-500">Please create a property first.</div>
  }

  return (
    <div className="w-full">
      <Tabs defaultValue="room-types" className="w-full">
        <TabsList className="bg-slate-100/50 mb-6">
          <TabsTrigger value="room-types"><BedDouble className="w-4 h-4 mr-2"/> Room Types</TabsTrigger>
          <TabsTrigger value="buildings-floors-rooms"><Building2 className="w-4 h-4 mr-2"/> Buildings, Floors, & Rooms</TabsTrigger>
        </TabsList>
        
        <TabsContent value="room-types" className="m-0">
          <RoomTypeManager propertyId={propertyId} />
        </TabsContent>
        
        <TabsContent value="buildings-floors-rooms" className="m-0">
          <RoomManager propertyId={propertyId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
