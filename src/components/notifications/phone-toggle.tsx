"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { disablePush, enablePush, pushSupport, type PushSupport } from "@/lib/notifications/push-client"

// Turn phone / browser notifications on or off for THIS device. Renders nothing when the
// server has no push keys or the browser cannot do push. `footer` sits at the bottom of the
// bell; `card` is the version on the notifications page.
export function PhoneToggle({ variant = "footer" }: { variant?: "footer" | "card" }) {
  const [support, setSupport] = useState<PushSupport | null>(null)
  const [config, setConfig] = useState<{ configured: boolean; publicKey: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [s, c] = await Promise.all([
        pushSupport(),
        fetch("/api/notifications/push", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      if (alive) {
        setSupport(s)
        setConfig(c)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (!support || !config?.configured || support.state === "unsupported") return null

  const toggle = async () => {
    setBusy(true)
    setError(null)
    if (support.state === "on") {
      await disablePush()
    } else if (config.publicKey) {
      const problem = await enablePush(config.publicKey)
      if (problem) setError(problem)
    }
    setSupport(await pushSupport())
    setBusy(false)
  }

  return (
    <div className={variant === "footer" ? "border-t px-4 py-2.5 text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
      {support.state === "needs-install" ? (
        <p>To get notifications on this iPhone, add Uppsolut Stay to your Home Screen (Share, then Add to Home Screen) and open it from there.</p>
      ) : support.state === "denied" ? (
        <p>Notifications are blocked for this site. Allow them in your browser&apos;s site settings to get them on this device.</p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span>{support.state === "on" ? "Phone notifications are on for this device." : "Get notifications on this device, even when the app is closed."}</span>
          <Button variant="outline" size="sm" disabled={busy} onClick={toggle} className="shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : support.state === "on" ? "Turn off" : "Turn on"}
          </Button>
        </div>
      )}
      {error && <p className="mt-1 text-destructive">{error}</p>}
    </div>
  )
}

