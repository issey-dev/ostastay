"use client"

import { useEffect } from "react"

// Sets the browser tab's title — "Reservations · Uppsolut Stay" — so several open tabs,
// history and bookmarks can be told apart (DESKTOP_PLAN D12: every tab used to read
// "Uppsolut Stay"). A client effect rather than route metadata because most dashboard pages
// are client components and detail pages know their title (a guest, a conf #) only after
// they load. PageHeader and HubPageHeader render it, so a page gets its title for free.
export function DocumentTitle({ title }: { title?: string | null }) {
  useEffect(() => {
    if (!title) return
    document.title = `${title} · Uppsolut Stay`
  }, [title])
  return null
}
