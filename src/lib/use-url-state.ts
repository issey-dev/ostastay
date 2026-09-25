"use client"

import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

// Keep a piece of view state (the open tab, a filter) in the query string, so Back, refresh,
// bookmarks and links from elsewhere (e.g. the dashboard's "Departures" tile) land on the same
// view. DESKTOP_PLAN D3. `router.replace` — switching a tab is not a new history entry.
// The default value is left out of the URL so plain links stay clean.
//
//   const [tab, setTab] = useUrlState("tab", "arrivals")
//   <Tabs value={tab} onValueChange={setTab}>
//
// Pages using this must sit under a <Suspense> boundary (useSearchParams).
export function useUrlState<T extends string = string>(
  key: string,
  defaultValue: T,
  allowed?: readonly T[]
): [T, (value: T) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const raw = params.get(key)
  const value = (raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? raw : defaultValue) as T

  const setValue = useCallback(
    (next: T) => {
      const sp = new URLSearchParams(window.location.search)
      if (next === defaultValue || next === "") sp.delete(key)
      else sp.set(key, next)
      const qs = sp.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, key, defaultValue]
  )

  return [value, setValue]
}
