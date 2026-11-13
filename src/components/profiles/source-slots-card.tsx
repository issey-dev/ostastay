"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { GROUP_STATUS_LABEL, type GroupStatus } from "@/lib/group-status"

// Slots on a Source profile (Agent Portal plan A-25): every block that belongs to the source,
// with period, rooms held, booked (tentative / confirmed), status and cutoff.

type Slot = {
  id: string
  code: string
  name: string
  property: string
  status: string
  startDate: string
  endDate: string
  cutoffDate: string | null
  held: number
  tentative: number
  confirmed: number
}

export function SourceSlotsCard({ upid, slug }: { upid: string; slug: string }) {
  const [slots, setSlots] = useState<Slot[] | null>(null)
  useEffect(() => {
    fetch(`/api/profiles/${upid}/slots`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSlots)
      .catch(() => setSlots([]))
  }, [upid])

  return (
    <Card id="slots">
      <CardHeader>
        <CardTitle className="text-lg">Slots</CardTitle>
      </CardHeader>
      <CardContent>
        {!slots ? (
          <Skeleton className="h-20 w-full" />
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No slots yet. A slot is a group block for this source: requested from the agent portal, or created from Group Blocks.</p>
        ) : (
          <ul className="divide-y divide-border">
            {slots.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/e/${slug}/dashboard/groups/${s.id}`} className="font-medium hover:underline">
                    {s.code}
                  </Link>
                  <span className="ml-2 text-muted-foreground">{s.property}</span>
                  <p className="text-xs text-muted-foreground">
                    {format(parseISO(s.startDate), "d MMM")} to {format(parseISO(s.endDate), "d MMM yyyy")}
                    {s.cutoffDate ? ` · cutoff ${format(parseISO(s.cutoffDate), "d MMM")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs tabular-nums">
                  <span>{s.held} held</span>
                  <span>{s.tentative} tentative</span>
                  <span>{s.confirmed} confirmed</span>
                  <StatusBadge label={GROUP_STATUS_LABEL[s.status as GroupStatus] ?? s.status} status={s.status === "REQUESTED" ? "PENDING" : s.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
