"use client"

import { useEffect, useState } from "react"
import { Download, Loader2 } from "@/components/icons"
import { promptInstall, useInstallInfo } from "@/lib/pwa/install-store"

// "Install app" in the Account dialog. It appears only once the person has READ the one-time
// invitation notification (the server says so), and never when the app is already installed.
// Nothing here pops up on its own.
export function InstallAppRow({ open }: { open: boolean }) {
  const info = useInstallInfo()
  const [offered, setOffered] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showSteps, setShowSteps] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    void fetch("/api/notifications/install-offer", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { read: boolean } | null) => alive && setOffered(d?.read === true))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open])

  if (!offered || info.standalone) return null

  const onClick = async () => {
    if (info.canPrompt) {
      setBusy(true)
      await promptInstall()
      setBusy(false)
    } else {
      setShowSteps((v) => !v)
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">App</div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/60 outline-hidden focus-visible:ring-2 ring-ring"
      >
        {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Download className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate text-sm font-medium">Install app</span>
      </button>
      {showSteps && (
        <p className="text-xs text-muted-foreground">
          {info.ios
            ? "Tap the Share button in Safari, then Add to Home Screen. Phone notifications only work from the app on your Home Screen."
            : "Open your browser's menu and choose Install app (or Add to Home screen). If you do not see it, this browser may not support installing."}
        </p>
      )}
    </div>
  )
}
