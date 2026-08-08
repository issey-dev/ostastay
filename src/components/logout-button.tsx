"use client"

import { LogOut } from "@/components/icons"
import { SidebarMenuButton } from "@/components/ui/sidebar"

export function LogoutButton() {
  return (
    <SidebarMenuButton 
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
    >
      {/* Not text-destructive: this button lives on the Deep Maroon rail, where a red
          reads as low-contrast mud rather than as a warning — and signing out is not a
          destructive action anyway (nothing is lost; you sign back in). The rail's own
          foreground, with the hover state SidebarMenuButton already provides, is the
          right weight for it. */}
      <LogOut className="h-4 w-4" />
      <span>Log Out</span>
    </SidebarMenuButton>
  )
}
