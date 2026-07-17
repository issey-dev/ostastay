"use client"

import { Button } from "@/components/ui/button"

// Lives inside the EnterpriseBanner support-session variant (see
// src/app/e/[slug]/dashboard/layout.tsx) — gives the "acting as" indicator a real,
// always-reachable way out, instead of the exit control being buried in
// Controls > Support Access.
export function SupportSessionExitButton() {
  const exit = async () => {
    await fetch("/api/support-access/exit", { method: "POST" })
    window.location.reload()
  }

  return (
    <Button
      variant="outline"
      size="xs"
      className="border-accent-enterprise-foreground/30 bg-transparent text-accent-enterprise-foreground hover:bg-accent-enterprise-foreground/10 hover:text-accent-enterprise-foreground"
      onClick={exit}
    >
      Exit support session
    </Button>
  )
}
