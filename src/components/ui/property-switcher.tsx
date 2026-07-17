"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useProperty } from "@/components/providers/property-provider"
import { Building2 } from "lucide-react"

// Only rendered for ENTERPRISE-scoped users (isLocked === false) — a PROPERTY-scoped
// user has exactly one work location and never sees a switcher at all.
export function PropertySwitcher() {
  const { currentProperty, properties, isLocked, loading, setCurrentProperty } = useProperty()

  if (loading || isLocked || properties.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
      <Select
        value={currentProperty?.id ?? ""}
        onValueChange={(id) => {
          const property = properties.find((p) => p.id === id)
          if (property) setCurrentProperty(property)
        }}
      >
        <SelectTrigger className="h-8 min-w-[10rem] border-none bg-transparent shadow-none">
          <SelectValue placeholder="Select property">{currentProperty?.name}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {properties.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
