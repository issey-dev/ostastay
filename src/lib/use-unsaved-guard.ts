"use client"

import { useEffect } from "react"

// Warn before leaving a page with unsaved edits (DESKTOP_PLAN D11 — the booking form, profile
// edit and long settings forms lost everything on a stray navigation). Covers reload, tab close
// and the browser Back/links that leave the app (beforeunload). In-app <Link> navigation is not
// interceptable in the App Router, so long forms should also keep their Save visible.
//
//   useUnsavedGuard(form.formState.isDirty && !form.formState.isSubmitSuccessful)
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])
}
