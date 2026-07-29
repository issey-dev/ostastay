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

// Watches the property THIS session is working in for an End-of-Day business date roll.
//
// The server-side lockout (requireSession -> EodLockoutError) already stops the user
// acting on a closed date, but on its own it's silent: the user would only discover it
// on their next click, as an unexplained auth failure. This polls a cheap status route
// so the roll announces itself — a banner while EOD is running, then a modal and a real
// sign-out the moment the date actually rolls.
//
// Applies to every user with the property selected, not just PROPERTY-scoped staff: an
// enterprise admin viewing that property is just as much "logged in to it".

const POLL_MS = 30_000

type EodStatus = {
  propertyName: string | null
  eodInProgress: boolean
  businessDate: string | null
  forcedLogout: boolean
}

export function EodSessionWatch({ loginPath }: { loginPath: string }) {
  const [status, setStatus] = useState<EodStatus | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  // Once the roll is seen, stop polling and hold the modal open — further requests are
  // pointless (the session is dead) and would only race the sign-out below.
  const lockedOut = status?.forcedLogout === true
  const lockedOutRef = useRef(false)
  useEffect(() => {
    lockedOutRef.current = lockedOut
  }, [lockedOut])

  const check = useCallback(() => {
    if (lockedOutRef.current) return
    fetch("/api/session/eod-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setStatus(data)
      })
      .catch(() => {
        // Offline or a transient failure — say nothing rather than announcing a roll
        // that may not have happened. The next tick re-checks.
      })
  }, [])

  useEffect(() => {
    check()
    const timer = setInterval(check, POLL_MS)
    // Catches the common case of a laptop that was asleep through the whole audit —
    // the user comes back to a stale tab and finds out immediately, not 30s later.
    const onFocus = () => check()
    window.addEventListener("focus", onFocus)
    // Dispatched by the Night Audit page the instant it finalizes, so the operator who
    // ran the roll sees the notice immediately instead of on the next tick.
    window.addEventListener("osta:eod-finalized", onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("osta:eod-finalized", onFocus)
    }
  }, [check])

  const signOut = useCallback(() => {
    setSigningOut(true)
    fetch("/api/auth/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        // Full navigation, not router.push — every cached server component in this tab
        // was rendered against the closed business date.
        window.location.href = loginPath
      })
  }, [loginPath])

  // Auto sign-out shortly after the notice appears, so an unattended terminal doesn't
  // sit on a closed date waiting for someone to click. The button just skips the wait.
  useEffect(() => {
    if (!lockedOut) return
    const timer = setTimeout(signOut, 10_000)
    return () => clearTimeout(timer)
  }, [lockedOut, signOut])

  if (lockedOut) {
    return (
      <Dialog open>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>End-of-Day complete — signing you out</DialogTitle>
            <DialogDescription>
              {status?.propertyName ?? "This property"} has finished its End-of-Day
              business date roll. Your session was working on the closed date, so it has
              been ended. Sign in again to continue on the new business date.
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

  if (status?.eodInProgress) {
    return (
      <div className="print:hidden w-full bg-warning/15 text-warning-foreground border-b border-warning/30 px-4 py-1.5 text-xs text-center">
        End-of-Day business date roll in progress for{" "}
        {status.propertyName ?? "this property"}. You&apos;ll be signed out when it
        completes — finish or park what you&apos;re doing.
      </div>
    )
  }

  return null
}
