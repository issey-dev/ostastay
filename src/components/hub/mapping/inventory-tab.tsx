"use client"

import { useState } from "react"
import { RefreshCw } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { AvailabilityPreview } from "@/components/hub/availability-preview"

// Resync availability for a chosen date range — the on-demand counterpart to the scheduled
// channelAriPushJob (src/lib/jobs/index.ts), for when an operator needs numbers at the
// channel to reflect a change right now rather than at the next sweep.
export function InventoryTab({
  linkId,
  propertyName,
  canManage,
}: {
  linkId: string
  propertyName: string
  canManage: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold">Resync availability</h4>
          <p className="text-sm text-muted-foreground">
            Recompute and push room-type availability for any date range, on demand — the same numbers the
            scheduled sync would send, without waiting for it.
          </p>
        </div>
        <Button variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Resync
        </Button>
      </div>

      {open && (
        <AvailabilityPreview
          linkId={linkId}
          propertyName={propertyName}
          canPush={canManage}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  )
}
