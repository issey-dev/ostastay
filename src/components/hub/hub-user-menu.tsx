"use client"

import { useState } from "react"
import { Check, ChevronsUpDown, Loader2, LogOut } from "@/components/icons"
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { initials } from "@/lib/initials"

type Property = { id: string; name: string; bannerColor: string | null }

// The Hub's sidebar-footer identity button and its Account dialog — the Hub counterpart
// of the property side's SidebarUserMenu (src/components/ui/sidebar-user-menu.tsx), laid
// out the same way: profile, "Open property dashboard" (the property side's "Switch
// property", pointed the other way — leaving the Hub for a property's operations) and
// sign-out, all in one compact dialog instead of permanent rows on the rail.
//
// Not SidebarUserMenu itself: that calls useProperty(), which by design does not exist in
// the Hub — the property list and the current pick come down as server-rendered props.
export function HubUserMenu({
  slug,
  name,
  roleName,
  email,
  properties,
  currentPropertyId,
}: {
  slug: string
  name: string
  roleName: string
  email?: string | null
  /** Properties this user can open the operations dashboard for; empty for a Hub-only admin. */
  properties: Property[]
  currentPropertyId: string | null
}) {
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  const openDashboard = async (id: string) => {
    setSwitching(id)
    try {
      await fetch("/api/session/current-property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: id }),
      })
      window.location.href = `/e/${slug}/dashboard`
    } catch {
      setSwitching(null)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    await fetch("/api/auth/logout", { method: "POST" })
    window.location.href = "/login"
  }

  return (
    <SidebarMenuItem>
      {/* On the Deep Maroon rail, so sidebar-* tokens; the dialog is portaled to <body> and
          is a normal content surface, so it uses the content tokens. */}
      <SidebarMenuButton onClick={() => setOpen(true)} tooltip={name} className="h-auto py-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
          {initials(name) || "U"}
        </span>
        <div className="flex flex-col items-start min-w-0">
          <span className="text-sm font-semibold truncate w-full leading-tight">{name}</span>
          <span className="text-xs text-sidebar-foreground/70 truncate w-full leading-tight">{roleName}</span>
        </div>
        <ChevronsUpDown className="ml-auto h-4 w-4 text-sidebar-foreground/70 shrink-0" />
      </SidebarMenuButton>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Account</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
              {initials(name) || "U"}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{name}</div>
              <div className="text-xs text-muted-foreground truncate">{roleName}</div>
              {email && <div className="text-xs text-muted-foreground truncate">{email}</div>}
            </div>
          </div>

          {properties.length > 0 && (
            <div className="space-y-2">
              <div className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                Open property dashboard
              </div>
              <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                {properties.map((p) => {
                  const active = p.id === currentPropertyId
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={switching !== null}
                      onClick={() => void openDashboard(p.id)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                        active ? "border-foreground/30 bg-muted" : "border-border hover:bg-muted/60"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: p.bannerColor ?? "var(--muted-foreground)" }}
                      />
                      <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                      {switching === p.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : active ? (
                        <Check className="h-4 w-4 text-foreground" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="border-t border-border pt-4">
            <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogOut className="h-4 w-4 mr-2" />}
              Log out
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  )
}
