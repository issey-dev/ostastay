"use client"

import { useState } from "react"
import { ArrowLeftRight, Check, ChevronsUpDown, Loader2, LogOut } from "@/components/icons"
import { useProperty } from "@/components/providers/property-provider"
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

// Shared with OstaSidebar/HubSidebar's own footer identity row — those shells can't
// reuse this whole component (it calls useProperty(), which by design doesn't exist
// outside the tenant dashboard), but the avatar-initials treatment is pure and cheap
// to share so the identity row looks the same everywhere. Lives in a plain (no
// "use client") module: OstaSidebar/HubSidebar are Server Components, and calling a
// plain function imported from THIS "use client" file crashes at render — Next.js
// replaces client-module exports with a reference proxy on the server module graph
// that only supports being rendered as a Component, not invoked directly.
import { initials } from "@/lib/initials"

// The consolidated User & Property menu in the sidebar footer. The footer shows a
// single compact identity button; clicking it opens a modal that gathers profile
// info, property switching, and sign-out in one place (a natural home for future
// user-preference options too). Styled to match the earlier property modal.
export function SidebarUserMenu({
  name,
  roleName,
  email,
  hubHref,
}: {
  name: string
  roleName: string
  email?: string | null
  /** Present only when this user has enterprise Hub access — renders a "Hub" row
   *  above the property switcher so leaving the property is as discoverable as
   *  switching between properties, without needing its own permanent sidebar slot. */
  hubHref?: string
}) {
  const { currentProperty, properties, isLocked, loading } = useProperty()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleSwitch = async (id: string) => {
    if (isLocked || id === currentProperty?.id) return
    setSwitching(id)
    try {
      await fetch("/api/session/current-property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: id }),
      })
      // Full reload: the choice is persisted server-side, so the whole app
      // re-renders and loads the property's data on demand.
      window.location.reload()
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
      <SidebarMenuButton onClick={() => setOpen(true)} tooltip={name} className="h-auto py-2">
        {/* This trigger sits on the Deep Maroon rail, so it takes sidebar-* tokens. The
            dialog below is portaled to <body> and is a normal content surface, which is
            why it keeps using bg-muted / text-muted-foreground and should NOT be changed
            to match this. */}
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

          {/* Profile */}
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

          {/* Hub */}
          {hubHref && (
            <div className="space-y-2">
              <div className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                Enterprise
              </div>
              <a
                href={hubHref}
                className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
              >
                <ArrowLeftRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-sm font-medium">Hub</span>
              </a>
            </div>
          )}

          {/* Property */}
          <div className="space-y-2">
            <div className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
              {isLocked ? "Property" : "Switch property"}
            </div>
            {loading || properties.length === 0 ? (
              <p className="text-sm text-muted-foreground">No property assigned.</p>
            ) : (
              <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                {properties.map((p) => {
                  const active = p.id === currentProperty?.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={isLocked || switching !== null}
                      onClick={() => handleSwitch(p.id)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        active ? "border-foreground/30 bg-muted" : "border-border hover:bg-muted/60"
                      } ${isLocked ? "cursor-default disabled:opacity-100" : "disabled:opacity-60"}`}
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
            )}
          </div>

          {/* Sign out */}
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
