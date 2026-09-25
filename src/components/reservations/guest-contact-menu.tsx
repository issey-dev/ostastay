"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Phone, Mail, Loader2 } from "@/components/icons"

type Comm = { id: string; type: string; value: string; isPrimary: boolean }

/**
 * Phone-only "Contact" button for a reservation's guest: tap → the guest's phone numbers and
 * emails as tel:/mailto: links (.agents/docs/MOBILE_PLAN.md §3, reservation detail). The
 * reservation payload carries the bare profile without its communications, so the list is
 * fetched from the profile API only when the menu is opened — nothing loads on desktop,
 * where this button is not rendered (`md:hidden` on the caller).
 */
export function GuestContactMenu({ upid, className }: { upid?: string | null; className?: string }) {
  const [comms, setComms] = useState<Comm[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = async () => {
    if (!upid || comms || loading) return
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/profiles/${upid}`)
      if (!res.ok) throw new Error()
      const p = await res.json()
      const list: Comm[] = (p.communications ?? []).filter((c: Comm) => c.type === "MOBILE" || c.type === "EMAIL")
      list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      setComms(list)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  if (!upid) return null
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) load() }}>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className={className} />}>
        <Phone className="h-4 w-4 mr-1.5" /> Contact
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : failed ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">Couldn&apos;t load contact details.</div>
        ) : comms && comms.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">No phone or email on this profile.</div>
        ) : (
          (comms ?? []).map((c) => {
            const isPhone = c.type === "MOBILE"
            const href = isPhone ? `tel:${c.value.trim().replace(/[^\d+]/g, "")}` : `mailto:${c.value.trim()}`
            const Icon = isPhone ? Phone : Mail
            return (
              <DropdownMenuItem key={c.id} render={<a href={href} />}>
                <Icon className="h-4 w-4" />
                <span className="break-all">{c.value}</span>
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
