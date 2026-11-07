"use client"

import { useEffect, useState } from "react"
import { Download, X } from "@/components/icons"
import { Button } from "@/components/ui/button"

// Offers to install the app on the home screen / desktop. Installed, the app opens without
// browser chrome and (later) can receive phone notifications.
//
//   Android / desktop Chrome and Edge: the browser fires `beforeinstallprompt`; one tap installs.
//   iPhone / iPad (Safari): there is no prompt, so we show the Share → Add to Home Screen steps.
//
// Never shown when already installed, and once dismissed it stays away for 30 days.

const DISMISS_KEY = "install-prompt-dismissed-at"
const QUIET_DAYS = 30

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    return at > 0 && Date.now() - at < QUIET_DAYS * 86_400_000
  } catch {
    return false
  }
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1)
}

export function InstallAppPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null)
  const [iosHint, setIosHint] = useState(false)
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvent(e as InstallEvent)
      setHidden(false)
    }
    const onInstalled = () => setHidden(true)
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    if (isIos()) {
      setIosHint(true)
      setHidden(false)
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {}
    setHidden(true)
  }

  const install = async () => {
    if (!event) return
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === "dismissed") dismiss()
    else setHidden(true)
  }

  if (hidden || (!event && !iosHint)) return null

  return (
    <div
      role="region"
      aria-label="Install the app"
      className="fixed left-4 right-4 sm:right-auto sm:w-[360px] z-[var(--z-toast)] rounded-lg border bg-card p-4 shadow-elevation-3 bottom-[calc(1rem+var(--bottom-nav-offset,0px)+env(safe-area-inset-bottom))] print:hidden"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="absolute top-2 right-2 rounded p-1 text-muted-foreground hover:text-foreground outline-hidden focus-visible:ring-2 ring-ring"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="pr-6 text-sm font-semibold text-foreground">Install Uppsolut Stay</p>
      {event ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Open it like an app, straight from your home screen or desktop. It also lets the app send you notifications later.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" className="gap-1.5" onClick={install}>
              <Download className="h-4 w-4" /> Install
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>Not now</Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            To install on this iPhone or iPad: tap the <strong>Share</strong> button in Safari, then <strong>Add to Home Screen</strong>.
            Phone notifications only work from the installed app.
          </p>
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={dismiss}>Got it</Button>
          </div>
        </>
      )}
    </div>
  )
}
