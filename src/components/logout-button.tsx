"use client"

import { LogOut } from "lucide-react"
import { SidebarMenuButton } from "@/components/ui/sidebar"

export function LogoutButton() {
  return (
    <SidebarMenuButton 
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
    >
      <LogOut className="h-4 w-4 text-destructive" />
      <span className="text-destructive">Log Out</span>
    </SidebarMenuButton>
  )
}
