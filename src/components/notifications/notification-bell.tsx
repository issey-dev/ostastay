"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Loader2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// The header bell (NOTIFICATIONS_PLAN.md §5): unread badge + a list of the signed-in
// person's own notifications. Shown in both the dashboard and the Hub header.
//
// No polling (house rule): the count loads once, then refreshes when the window regains
// focus, when the service worker reports a push, and after the person's own actions.

type Item = { id: string; type: string; severity: string; title: string; body: string | null; url: string | null; createdAt: string; read: boolean }
type Page = { items: Item[]; nextBefore: string | null; unreadCount: number }

const PAGE = 15
const REFRESH_AT_MOST_EVERY_MS = 20_000

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
}

const DOT: Record<string, string> = {
  URGENT: "bg-destructive",
  ACTION: "bg-amber-500",
  INFO: "bg-muted-foreground/50",
}

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

export function NotificationBell({ className }: { className?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
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

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications"

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void load(true)
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            title="Notifications"
            className={cn(
              "relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground outline-hidden focus-visible:ring-2 ring-ring",
              className,
            )}
          />
        }
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
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
          {next && (
            <div className="border-t p-2 text-center">
              <Button variant="ghost" size="sm" onClick={more} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Show older"}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
