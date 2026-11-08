"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, NotificationBell as BellIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"
import { PhoneToggle } from "@/components/notifications/phone-toggle"
import { DOT, ago } from "@/components/notifications/format"
import { cn } from "@/lib/utils"

// The header bell (NOTIFICATIONS_PLAN.md §5): unread badge + a list of the signed-in
// person's own notifications. Shown in the dashboard, the Hub and the Osta console header.
//
// Phones (below md) get a swipe-down bottom sheet instead of the popover: a popover pinned
// to a 36px icon in the header corner was a cramped, oddly-anchored box on a 375px screen.
// The sheet uses the full width, bigger rows, an All/Unread switch and day headings, and
// keeps "Mark all read", the phone-push toggle and the full-page link within thumb reach.
//
// No polling (house rule): the count loads once, then refreshes when the window regains
// focus, when the service worker reports a push, and after the person's own actions.

type Item = { id: string; type: string; severity: string; title: string; body: string | null; url: string | null; createdAt: string; read: boolean }
type Page = { items: Item[]; nextBefore: string | null; unreadCount: number }

const PAGE = 15
const REFRESH_AT_MOST_EVERY_MS = 20_000

async function fetchPage(before?: string | null): Promise<Page | null> {
  try {
    const qs = new URLSearchParams({ limit: String(PAGE) })
    if (before) qs.set("before", before)
    const res = await fetch(`/api/notifications?${qs}`, { cache: "no-store" })
    return res.ok ? ((await res.json()) as Page) : null
  } catch {
    return null
  }
}

export function NotificationBell({ className, allHref }: { className?: string; allHref?: string }) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const lastLoad = useRef(0)

  const load = useCallback(async (force = false) => {
    if (!force && Date.now() - lastLoad.current < REFRESH_AT_MOST_EVERY_MS) return
    lastLoad.current = Date.now()
    const page = await fetchPage()
    if (!page) return
    setItems(page.items)
    setNext(page.nextBefore)
    setUnread(page.unreadCount)
    setLoaded(true)
  }, [])

  useEffect(() => {
    // Initial load from the server — the one-off fetch the bell needs to show its count.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true)
    const onFocus = () => document.visibilityState === "visible" && void load()
    const onMessage = (e: MessageEvent) => e.data?.type === "notification:new" && void load(true)
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)
    navigator.serviceWorker?.addEventListener("message", onMessage)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
      navigator.serviceWorker?.removeEventListener("message", onMessage)
    }
  }, [load])

  // The installed app's icon badge. Not supported everywhere; ignore failures.
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (unread > 0) void nav.setAppBadge?.(unread).catch(() => {})
    else void nav.clearAppBadge?.().catch(() => {})
  }, [unread])

  const markRead = async (body: { all: true } | { ids: string[] }) => {
    try {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) setUnread(((await res.json()) as { unreadCount: number }).unreadCount)
    } catch {
      /* the next refresh corrects the badge */
    }
  }

  const openItem = (it: Item) => {
    if (!it.read) {
      setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, read: true } : x)))
      setUnread((n) => Math.max(0, n - 1))
      void markRead({ ids: [it.id] })
    }
    setOpen(false)
    if (it.url) router.push(it.url)
  }

  const markAll = () => {
    setItems((cur) => cur.map((x) => ({ ...x, read: true })))
    setUnread(0)
    void markRead({ all: true })
  }

  const more = async () => {
    if (!next) return
    setLoading(true)
    const page = await fetchPage(next)
    setLoading(false)
    if (!page) return
    setItems((cur) => [...cur, ...page.items])
    setNext(page.nextBefore)
  }

  const onOpenChange = (o: boolean) => {
    setOpen(o)
    if (o) void load(true)
  }

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
  const trigger = (
    <button
      type="button"
      aria-label={label}
      title="Notifications"
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground outline-hidden focus-visible:ring-2 ring-ring",
        className,
      )}
    />
  )
  const triggerContent = (
    <>
      <BellIcon className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </>
  )
  const older = next && (
    <div className="border-t p-2 text-center">
      <Button variant="ghost" size="sm" onClick={more} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Show older"}
      </Button>
    </div>
  )

  if (isMobile) {
    const shown = onlyUnread ? items.filter((x) => !x.read) : items
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerTrigger render={trigger}>{triggerContent}</DrawerTrigger>
        <DrawerContent initialFocus={false} className="h-[85dvh]">
          <DrawerHeader className="space-y-3 border-b pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <DrawerTitle>Notifications</DrawerTitle>
                <DrawerDescription className="text-xs">{unread > 0 ? `${unread} unread` : "Nothing unread"}</DrawerDescription>
              </div>
              <Button variant="ghost" size="sm" disabled={unread === 0} onClick={markAll} className="shrink-0">
                Mark all read
              </Button>
            </div>
            <div role="tablist" aria-label="Show" className="grid grid-cols-2 rounded-lg bg-muted p-0.5 text-sm">
              {([false, true] as const).map((u) => (
                <button
                  key={String(u)}
                  type="button"
                  role="tab"
                  aria-selected={onlyUnread === u}
                  onClick={() => setOnlyUnread(u)}
                  className={cn(
                    "h-8 rounded-md font-medium transition-colors",
                    onlyUnread === u ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {u ? `Unread${unread > 0 ? ` (${unread})` : ""}` : "All"}
                </button>
              ))}
            </div>
          </DrawerHeader>
          <DrawerBody className="px-0 pb-0">
            {!loaded ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : shown.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <BellIcon className="h-6 w-6 text-muted-foreground" />
                </span>
                <p className="text-sm font-medium text-foreground">You&apos;re all caught up.</p>
                <p className="text-xs text-muted-foreground">
                  {onlyUnread && items.length > 0 ? "Nothing unread. Switch to All to see earlier ones." : "New notifications will show up here."}
                </p>
              </div>
            ) : (
              groupByDay(shown).map((g) => (
                <section key={g.label} aria-label={g.label}>
                  <h3 className="sticky top-0 z-10 bg-popover/95 px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
                    {g.label}
                  </h3>
                  <ul className="divide-y divide-border/60">
                    {g.items.map((it) => (
                      <li key={it.id}>
                        <button
                          type="button"
                          onClick={() => openItem(it)}
                          className={cn(
                            "flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-muted outline-hidden focus-visible:bg-muted/60",
                            !it.read && "bg-primary/[0.04]",
                          )}
                        >
                          <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", it.read ? "bg-transparent" : (DOT[it.severity] ?? DOT.INFO))} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className={cn("text-[15px] leading-snug text-foreground", !it.read && "font-semibold")}>{it.title}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">{ago(it.createdAt)}</span>
                            </span>
                            {it.body && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{it.body}</span>}
                            {it.severity === "URGENT" && (
                              <span className="mt-1.5 inline-block rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">Urgent</span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
            {older}
          </DrawerBody>
          <div className="shrink-0 border-t">
            <PhoneToggle />
            {allHref && (
              <div className="px-4 pt-2 pb-1">
                <Button variant="outline" className="h-11 w-full" nativeButton={false} render={<Link href={allHref} onClick={() => setOpen(false)} />}>
                  All notifications and settings
                </Button>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger}>{triggerContent}</PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          <Button variant="ghost" size="sm" disabled={unread === 0} onClick={markAll}>
            Mark all read
          </Button>
        </div>
        <div className="max-h-[min(28rem,70dvh)] overflow-y-auto">
          {!loaded ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            <ul>
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => openItem(it)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 outline-hidden focus-visible:bg-muted/60",
                      !it.read && "bg-muted/30",
                    )}
                  >
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", it.read ? "bg-transparent" : (DOT[it.severity] ?? DOT.INFO))} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm text-foreground", !it.read && "font-semibold")}>{it.title}</span>
                      {it.body && <span className="block truncate text-xs text-muted-foreground">{it.body}</span>}
                      <span className="block text-xs text-muted-foreground">
                        {ago(it.createdAt)}
                        {it.severity === "URGENT" && <span className="ml-2 font-medium text-destructive">Urgent</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {older}
        </div>
        {allHref && (
          <div className="border-t px-4 py-2 text-center">
            <Link href={allHref} onClick={() => setOpen(false)} className="text-xs font-medium text-foreground hover:underline">
              All notifications and settings
            </Link>
          </div>
        )}
        <PhoneToggle />
      </PopoverContent>
    </Popover>
  )
}

/** Today / Yesterday / Earlier, by the phone's local date. Items arrive newest first. */
function groupByDay(items: Item[]): { label: string; items: Item[] }[] {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = day(new Date())
  const yesterday = today - 86_400_000
  const groups: { label: string; items: Item[] }[] = []
  for (const it of items) {
    const t = day(new Date(it.createdAt))
    const label = t === today ? "Today" : t === yesterday ? "Yesterday" : "Earlier"
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(it)
    else groups.push({ label, items: [it] })
  }
  return groups
}
