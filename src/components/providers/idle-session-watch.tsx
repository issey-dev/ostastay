"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, LogOut } from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useProperty } from "@/components/providers/property-provider"

// Ends the session when the property's idle timeout elapses with zero real interaction
// — mouse, keyboard, touch, or scroll — in this tab.
//
// Deliberately NOT a polling loop. EodSessionWatch already runs one (it has to: an EOD
// roll is an external event with no other way to announce itself), and folding idle
// detection into that same 30s server round-trip was the first draft of this fix — but
// it meant every open tab, at every property, hit the database every 30 seconds forever,
// active or not. That doesn't scale, and it isn't even necessary: unlike an EOD roll,
// idle-ness is something the browser already knows about locally.
//
// So instead: with the timeout off (sessionIdleMinutes = 0, the property default), this
// component adds no listeners, no timers, and makes no requests — zero cost for the
// common case. With it on, a local clock does the waiting (a 60s tick doing a plain
// Date.now() comparison — negligible, and matches the server's own once-a-minute
// activity granularity), and the server is only asked once, right when this tab
// actually looks idle, rather than on a fixed schedule. That single check also protects
// a multi-tab user: if another tab of the same session has been genuinely active,
// requireSession() there kept the real lastSeenAt fresh, so this check succeeds and the
// local clock just resets instead of signing anyone out from under them.
const CHECK_INTERVAL_MS = 60_000
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"] as const

export function IdleSessionWatch({ loginPath }: { loginPath: string }) {
  const { currentProperty } = useProperty()
  const idleMinutes = currentProperty?.sessionIdleMinutes ?? 0

  const [expired, setExpired] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const lastActivityRef = useRef(Date.now())
  const checkingRef = useRef(false)
  const expiredRef = useRef(false)
  useEffect(() => {
    expiredRef.current = expired
  }, [expired])

  const noteActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
  }, [])

  useEffect(() => {
    if (idleMinutes <= 0) return
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, noteActivity, { passive: true }))
    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, noteActivity))
    }
  }, [idleMinutes, noteActivity])

  useEffect(() => {
    if (idleMinutes <= 0) return
    const thresholdMs = idleMinutes * 60_000

    const tick = () => {
      if (checkingRef.current || expiredRef.current) return
      if (Date.now() - lastActivityRef.current < thresholdMs) return
      checkingRef.current = true
      fetch("/api/session/idle-check")
        .then((res) => {
          if (res.ok) {
            // A different tab of this session was active — this tab was just quiet.
            noteActivity()
          } else {
            setExpired(true)
          }
        })
        .catch(() => {
          // Offline or a transient failure — don't sign anyone out on a network blip.
          // The next tick tries again.
        })
        .finally(() => {
          checkingRef.current = false
        })
    }

    const timer = setInterval(tick, CHECK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [idleMinutes, noteActivity])

  const signOut = useCallback(() => {
    setSigningOut(true)
    fetch("/api/auth/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        // Full navigation, not router.push — every cached server component in this tab
        // was rendered against a now-dead session.
        window.location.href = loginPath
      })
  }, [loginPath])

  // Auto sign-out shortly after the notice appears, so an unattended terminal doesn't
  // sit signed-in-looking waiting for someone to click. The button just skips the wait.
  useEffect(() => {
    if (!expired) return
    const timer = setTimeout(signOut, 10_000)
    return () => clearTimeout(timer)
  }, [expired, signOut])

  if (!expired) return null

  return (
    <Dialog open>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Signed out — inactivity</DialogTitle>
          <DialogDescription>
            You were signed out after a period of inactivity, per this property&apos;s
            session timeout. Sign in again to continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={signOut} disabled={signingOut}>
            {signingOut ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <LogOut className="w-4 h-4 mr-2" />
            )}
            Sign in again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
