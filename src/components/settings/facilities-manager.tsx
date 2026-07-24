"use client"

import { useState, useEffect } from "react"
import { RoomTypeManager } from "@/components/inventory/room-type-manager"
import { RoomManager } from "@/components/inventory/room-manager"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { BedDouble, Building2, Map, Plus } from "lucide-react"

// "Table + Nav + Button" card (Settings.dc.html): the tab nav sits on the left and the
// primary Add action on the right of a single header row, its label following the active
// tab. The Add button lives here rather than in each child manager so the two share one
// row exactly as the mockup shows. Clicking it bumps `addSignal`, which the mounted
// child watches to open its own Add dialog — the child keeps ownership of its form/state,
// the parent only owns the row layout and the "add was requested" intent.
const TABS = [
  { id: "room-types", label: "Room Types", addLabel: "Room Type", icon: BedDouble },
  { id: "buildings", label: "Buildings", addLabel: "Building", icon: Building2 },
  { id: "floors", label: "Floors", addLabel: "Floor", icon: Map },
  { id: "rooms", label: "Rooms", addLabel: "Room", icon: BedDouble },
] as const

export function FacilitiesManager() {
  const [propertyId, setPropertyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("room-types")
  // Monotonic counter — bumped on each Add click. Children skip its initial value on
  // mount (see their firstRun guard) so switching tabs never auto-opens a dialog.
  const [addSignal, setAddSignal] = useState(0)

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
    return <div className="py-12 text-center text-muted-foreground">Loading configurations...</div>
  }

  if (!propertyId) {
    return <div className="py-12 text-center text-destructive">Please create a property first.</div>
  }

  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0]

  return (
    <div className="w-full">
      <Tabs value={tab} onValueChange={(v) => setTab((v as typeof tab) ?? tab)} className="w-full">
        {/* Nav left, Add right — one row (mockup). Wraps on narrow widths. */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <TabsList className="bg-muted flex-wrap h-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                <t.icon className="w-4 h-4 mr-2" /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button className="shadow-sm" onClick={() => setAddSignal((n) => n + 1)}>
            <Plus className="mr-2 h-4 w-4" /> Add {activeTab.addLabel}
          </Button>
        </div>

        <TabsContent value="room-types" className="m-0">
          <RoomTypeManager propertyId={propertyId} addSignal={addSignal} hideAddButton />
        </TabsContent>

        <TabsContent value="buildings" className="m-0">
          <RoomManager propertyId={propertyId} view="buildings" addSignal={addSignal} hideAddButton />
        </TabsContent>

        <TabsContent value="floors" className="m-0">
          <RoomManager propertyId={propertyId} view="floors" addSignal={addSignal} hideAddButton />
        </TabsContent>

        <TabsContent value="rooms" className="m-0">
          <RoomManager propertyId={propertyId} view="rooms" addSignal={addSignal} hideAddButton />
        </TabsContent>
      </Tabs>
    </div>
  )
}
