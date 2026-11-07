"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { EmptyState } from "@/components/ui/empty-state"
import { Bell } from "@/components/icons"
import { PhoneToggle } from "@/components/notifications/phone-toggle"
import { DOT, ago } from "@/components/notifications/format"
import { cn } from "@/lib/utils"

// The full notifications page (NOTIFICATIONS_PLAN.md §5): everything you have received, and
// your choices. Used in the dashboard and in the Hub. The bell is the quick view; this is the
// history and the settings.

type Item = { id: string; type: string; severity: string; title: string; body: string | null; url: string | null; createdAt: string; read: boolean }
type Page = { items: Item[]; nextBefore: string | null; unreadCount: number }
type Pref = { type: string; label: string; description: string; group: string; locked: boolean; inApp: boolean; push: boolean; pushable: boolean }

const PAGE = 25

export function NotificationCenter({ initialTab = "inbox" }: { initialTab?: "inbox" | "settings" }) {
  const [tab, setTab] = useState<"inbox" | "settings">(initialTab)

  const switchTab = (t: "inbox" | "settings") => {
    setTab(t)
    // Keep the tab in the address so a reload or a shared link lands on the same one.
    const url = new URL(window.location.href)
    if (t === "settings") url.searchParams.set("tab", "settings")
    else url.searchParams.delete("tab")
    window.history.replaceState(null, "", url)
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Notifications" className="flex gap-1 border-b">
        {(["inbox", "settings"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => switchTab(t)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium outline-hidden focus-visible:ring-2 ring-ring",
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "inbox" ? "Inbox" : "Settings"}
          </button>
        ))}
      </div>
      {tab === "inbox" ? <Inbox /> : <Settings />}
    </div>
  )
}

function Inbox() {
  const router = useRouter()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)

  const fetchPage = useCallback(
    async (before?: string | null): Promise<Page | null> => {
      const qs = new URLSearchParams({ limit: String(PAGE) })
      if (before) qs.set("before", before)
      if (unreadOnly) qs.set("unread", "1")
      try {
        const res = await fetch(`/api/notifications?${qs}`, { cache: "no-store" })
        return res.ok ? ((await res.json()) as Page) : null
      } catch {
        return null
      }
    },
    [unreadOnly],
  )

  useEffect(() => {
    let alive = true
    void fetchPage().then((p) => {
      if (!alive) return
      if (p) {
        setItems(p.items)
        setNext(p.nextBefore)
        setUnread(p.unreadCount)
      }
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [fetchPage])

  const read = async (body: { all: true } | { ids: string[] }) => {
    try {
      const res = await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (res.ok) setUnread(((await res.json()) as { unreadCount: number }).unreadCount)
    } catch {
      /* the next load corrects the count */
    }
  }

  const open = (it: Item) => {
    if (!it.read) {
      setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, read: true } : x)))
      void read({ ids: [it.id] })
    }
    if (it.url) router.push(it.url)
  }

  const loadMore = async () => {
    if (!next) return
    setMore(true)
    const p = await fetchPage(next)
    setMore(false)
    if (p) {
      setItems((cur) => [...cur, ...p.items])
      setNext(p.nextBefore)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={unreadOnly} onCheckedChange={(v) => { setLoading(true); setUnreadOnly(v) }} aria-label="Show unread only" />
          Unread only{unread > 0 ? ` (${unread})` : ""}
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={unread === 0}
          onClick={() => {
            setItems((cur) => cur.map((x) => ({ ...x, read: true })))
            setUnread(0)
            void read({ all: true })
          }}
        >
          Mark all read
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title={unreadOnly ? "Nothing unread" : "No notifications yet"} description="You are all caught up." />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => open(it)}
                className={cn("flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 outline-hidden focus-visible:bg-muted/60", !it.read && "bg-muted/30")}
              >
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", it.read ? "bg-transparent" : (DOT[it.severity] ?? DOT.INFO))} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm text-foreground", !it.read && "font-semibold")}>{it.title}</span>
                  {it.body && <span className="block text-sm text-muted-foreground">{it.body}</span>}
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

      {next && !loading && (
        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={loadMore} disabled={more}>
            {more ? <Loader2 className="h-4 w-4 animate-spin" /> : "Show older"}
          </Button>
        </div>
      )}
    </div>
  )
}

function Settings() {
  const [prefs, setPrefs] = useState<Pref[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void fetch("/api/notifications/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { preferences: Pref[] } | null) => {
        if (!alive) return
        if (d) setPrefs(d.preferences)
        else setError("Could not load your settings.")
      })
      .catch(() => alive && setError("Could not load your settings."))
    return () => {
      alive = false
    }
  }, [])

  const change = async (type: string, patch: { inApp?: boolean; push?: boolean }) => {
    setError(null)
    const before = prefs
    // Optimistic: flip it now, put it back if the server says no.
    setPrefs((cur) => cur?.map((p) => (p.type === type ? { ...p, ...patch, ...(patch.inApp === false ? { push: false } : {}) } : p)) ?? null)
    try {
      const res = await fetch("/api/notifications/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, ...patch }) })
      if (!res.ok) throw new Error()
      setPrefs(((await res.json()) as { preferences: Pref[] }).preferences)
    } catch {
      setPrefs(before)
      setError("That change could not be saved. Try again.")
    }
  }

  const groups = prefs ? [...new Set(prefs.map((p) => p.group))] : []

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">This device</h2>
        <p className="mb-2 mt-1 text-sm text-muted-foreground">Phone and browser notifications are set up one device at a time.</p>
        <PhoneToggle variant="card" />
      </section>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {!prefs ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        groups.map((g) => (
          <section key={g} className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{g}</h2>
            <ul className="divide-y rounded-lg border bg-card">
              {prefs
                .filter((p) => p.group === g)
                .map((p) => (
                  <li key={p.type} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="text-sm font-medium text-foreground">{p.label}</p>
                      <p className="text-xs text-muted-foreground">{p.description}</p>
                    </div>
                    <div className="flex items-center gap-5 text-xs text-muted-foreground">
                      <label className="flex items-center gap-2">
                        <Switch size="sm" checked={p.inApp} disabled={p.locked} onCheckedChange={(v) => change(p.type, { inApp: v })} aria-label={`${p.label}: show in the bell`} />
                        Bell{p.locked ? " (always)" : ""}
                      </label>
                      <label className={cn("flex items-center gap-2", !p.pushable && "opacity-50")}>
                        <Switch
                          size="sm"
                          checked={p.pushable && p.inApp && p.push}
                          disabled={!p.pushable || !p.inApp}
                          onCheckedChange={(v) => change(p.type, { push: v })}
                          aria-label={`${p.label}: send to my devices`}
                        />
                        Phone
                      </label>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
