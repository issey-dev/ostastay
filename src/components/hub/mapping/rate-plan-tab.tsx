"use client"

import { useState } from "react"
import { DollarSign } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AvailabilityPreview } from "@/components/hub/availability-preview"
import { MappingInput } from "@/components/hub/mapping/mapping-input"

export type RatePlanMap = {
  ratePlanId: string
  ratePlanName: string
  ratePlanCode: string
  externalRateId: string | null
}

// External price slot ↔ rate plan, plus sending those prices for a chosen date range.
//
// Beds24 has no separate "push rates" endpoint — a room's availability and its sixteen
// numbered price slots travel together in one calendar payload (src/lib/channels/payload.ts).
// "Send prices" here is the same push as the Inventory tab's "resync availability", just
// framed for what this tab's operator actually came to do.
export function RatePlanTab({
  linkId,
  propertyName,
  ratePlans,
  canManage,
  onPatch,
}: {
  linkId: string
  propertyName: string
  ratePlans: RatePlanMap[]
  canManage: boolean
  onPatch: (payload: Record<string, unknown>, successMessage?: string) => Promise<boolean>
}) {
  const [sendOpen, setSendOpen] = useState(false)

  return (
    <div className="space-y-5">
      {ratePlans.length === 0 ? (
        <p className="text-sm text-muted-foreground">This property has no rate plans to map yet.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Beds24 stores prices in sixteen numbered slots per room rather than named rates. Enter which slot each
            plan should publish to — mapping is optional; a property can share availability on a single default
            rate before per-plan mapping exists.
          </p>
          {/* Phone view — the mapping input needs its own row width to be usable with a
              thumb, so each rate plan becomes a small card. */}
          <div className="space-y-3 md:hidden">
            {ratePlans.map((rp) => (
              <div key={rp.ratePlanId} className="space-y-3 rounded-md border border-border bg-card p-4">
                <div>
                  <span className="text-sm font-medium">{rp.ratePlanName}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{rp.ratePlanCode}</span>
                </div>
                <MappingInput
                  value={rp.externalRateId ?? ""}
                  disabled={!canManage}
                  placeholder="e.g. 1"
                  onSave={(v) => onPatch({ ratePlanId: rp.ratePlanId, externalRateId: v }, "Mapping saved")}
                />
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-md border border-border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rate plan</TableHead>
                  <TableHead>Price slot (1&ndash;16)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ratePlans.map((rp) => (
                  <TableRow key={rp.ratePlanId}>
                    <TableCell>
                      <span className="text-sm font-medium">{rp.ratePlanName}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{rp.ratePlanCode}</span>
                    </TableCell>
                    <TableCell>
                      <MappingInput
                        value={rp.externalRateId ?? ""}
                        disabled={!canManage}
                        placeholder="e.g. 1"
                        onSave={(v) => onPatch({ ratePlanId: rp.ratePlanId, externalRateId: v }, "Mapping saved")}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <div className="flex flex-col items-start gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold">Send prices for a date range</h4>
          <p className="text-sm text-muted-foreground">
            Push what&rsquo;s configured in the PMS for the mapped rate plans, for any date range you choose.
          </p>
        </div>
        <Button variant="outline" className="w-full sm:w-auto" onClick={() => setSendOpen(true)}>
          <DollarSign className="h-4 w-4 mr-2" />
          Send prices
        </Button>
      </div>

      {sendOpen && (
        <AvailabilityPreview
          linkId={linkId}
          propertyName={propertyName}
          canPush={canManage}
          open={sendOpen}
          onOpenChange={setSendOpen}
          title={`Prices to send — ${propertyName}`}
          description="Pick a date range. Availability travels with prices in the same push — nothing is sent by opening this."
          actionLabel="Send prices"
        />
      )}
    </div>
  )
}
