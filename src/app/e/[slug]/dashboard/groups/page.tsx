"use client"

import { useBusinessToday } from "@/hooks/use-business-today"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useProperty } from "@/components/providers/property-provider"
import { Users, Plus, Calendar as CalendarIcon, UserCheck, LayoutGrid, ListChecks } from "@/components/icons"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import { StatusBadge } from "@/components/ui/status-badge"
import { PageHeader } from "@/components/ui/page-header"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { FilterBar } from "@/components/ui/filter-bar"
import { useUrlState } from "@/lib/use-url-state"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"

type Group = {
  id: string
  code: string
  name: string
  status: string
  startDate: string
  endDate: string
  totalRoomsHeld: number
  cutoffDate?: string | null
  reservations?: { status: string }[]
  roomHolds?: { quantity: number; roomType: { code: string; name: string } }[]
  payeeProfile?: { companyName: string | null; firstName: string; lastName: string | null } | null
  postingMasterStatus?: string | null
}

// Cancelled and no-show pickups no longer hold a room of the block.
const pickedUpCount = (g: Group) => (g.reservations ?? []).filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW").length

type Badge = { key: string; label: string; title: string; tone: "muted" | "success" | "warning" | "info" | "destructive" }
const BADGE_TONE: Record<Badge["tone"], string> = {
  muted: "bg-muted text-muted-foreground ring-border",
  success: "bg-success-muted text-success ring-success/20",
  warning: "bg-warning-muted text-warning ring-warning/20",
  info: "bg-info-muted text-info ring-info/20",
  destructive: "bg-destructive-muted text-destructive ring-destructive/20",
}

// Small labelled badges for what is set on the block: the account it bills, its cutoff, the
// room types held, whether it is oversold and where its Posting Master is. Only what applies shows.
const groupBadges = (g: Group, today: Date): Badge[] => {
  const out: Badge[] = []
  const closed = g.status === "CANCELLED" || g.status === "LOST"
  if (g.payeeProfile) {
    const name = g.payeeProfile.companyName || [g.payeeProfile.firstName, g.payeeProfile.lastName].filter(Boolean).join(" ")
    out.push({ key: "ledger", label: `Bills ${name}`, title: `The master bill settles to ${name} (City Ledger)`, tone: "info" })
  }
  if (g.cutoffDate && !closed) {
    const cutoff = parseISO(g.cutoffDate.slice(0, 10))
    // Measured from the property's business date, not the device clock.
    const cutoffMs = Date.parse(`${g.cutoffDate.slice(0, 10)}T00:00:00Z`)
    const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    const days = Math.round((cutoffMs - todayMs) / 86_400_000)
    const label = `Cutoff ${format(cutoff, "dd MMM")}`
    if (days < 0) out.push({ key: "cutoff", label: `${label} · passed`, title: "The cutoff date has passed - unsold rooms are released", tone: "destructive" })
    else if (days <= 7) out.push({ key: "cutoff", label: `${label} · ${days === 0 ? "today" : `${days}d`}`, title: "The cutoff date is close", tone: "warning" })
    else out.push({ key: "cutoff", label, title: `Rooms are released after ${format(cutoff, "dd MMM yyyy")}`, tone: "muted" })
  }
  for (const h of g.roomHolds ?? []) {
    if (h.quantity > 0) out.push({ key: `hold-${h.roomType.code}`, label: `${h.quantity}× ${h.roomType.code}`, title: `${h.quantity} ${h.roomType.name} held`, tone: "muted" })
  }
  if (g.totalRoomsHeld > 0 && pickedUpCount(g) > g.totalRoomsHeld) {
    out.push({ key: "over", label: "Overbooked", title: `${pickedUpCount(g)} picked up against ${g.totalRoomsHeld} held`, tone: "warning" })
  }
  if (g.postingMasterStatus === "IN_HOUSE") out.push({ key: "pm", label: "Posting master in house", title: "The master folio is open and receiving the group's charges", tone: "success" })
  else if (g.postingMasterStatus === "RESERVED") out.push({ key: "pm", label: "Posting master", title: "Created; checks in with the first guest of the block", tone: "muted" })
  return out
}

function BadgeStrip({ badges }: { badges: Badge[] }) {
  if (badges.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {badges.map((b) => (
        <span key={b.key} title={b.title} className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-medium leading-4 ring-1 ring-inset ${BADGE_TONE[b.tone]}`}>
          {b.label}
        </span>
      ))}
    </div>
  )
}

// useUrlState reads the query string — the page needs a Suspense boundary.
export default function GroupsDashboard() {
  return (
    <Suspense>
      <GroupsList />
    </Suspense>
  )
}

function GroupsList() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const { currentProperty } = useProperty()
  const business = useBusinessToday()
  const today = business.ready ? business.today : new Date()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  // Desktop can show the blocks as cards instead of the table; phones always get cards.
  const [view, setView] = useState<"table" | "card">("table")
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("osta:groups-view")
      if (saved === "card" || saved === "table") setView(saved)
    } catch {}
  }, [])
  const chooseView = (v: "table" | "card") => {
    setView(v)
    try { window.localStorage.setItem("osta:groups-view", v) } catch {}
  }

  // The list is filtered in the browser as you type; the search follows into the URL
  // (?q=) 300 ms after the last keystroke so Back from a group keeps it. A URL change
  // that didn't come from typing (Back/Forward) flows back into the box.
  const [urlSearch, setUrlSearch] = useUrlState<string>("q", "")
  const [search, setSearch] = useState(urlSearch)
  const lastWrittenSearch = useRef(urlSearch)
  useEffect(() => {
    if (urlSearch !== lastWrittenSearch.current) {
      lastWrittenSearch.current = urlSearch
      setSearch(urlSearch)
    }
  }, [urlSearch])
  useEffect(() => {
    const next = search.trim()
    if (next === lastWrittenSearch.current) return
    const t = setTimeout(() => {
      lastWrittenSearch.current = next
      setUrlSearch(next)
    }, 300)
    return () => clearTimeout(t)
  }, [search, setUrlSearch])
  const clearSearch = () => {
    lastWrittenSearch.current = ""
    setSearch("")
    setUrlSearch("")
  }

  const fetchGroups = async () => {
    if (!currentProperty) return
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/groups?propertyId=${currentProperty.id}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setGroups(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGroups()
  }, [currentProperty])

  const term = search.trim().toLowerCase()
  const shown = useMemo(
    () => (term ? groups.filter((g) => g.name?.toLowerCase().includes(term) || g.code?.toLowerCase().includes(term)) : groups),
    [groups, term]
  )

  const groupUrl = (g: Group) => `/e/${slug}/dashboard/groups/${g.id}`

  const columns: ListColumn<Group>[] = [
    {
      key: "code",
      header: "Group code",
      sortValue: (g) => g.code,
      cell: (g) => (
        <span className="font-mono text-xs font-bold text-foreground bg-muted px-2 py-1 rounded-none">{g.code}</span>
      ),
    },
    { key: "name", header: "Name", primary: true, className: "font-semibold", sortValue: (g) => g.name, cell: (g) => g.name },
    {
      key: "dates",
      header: "Dates",
      className: "text-sm text-muted-foreground",
      sortValue: (g) => g.startDate,
      csv: (g) => `${g.startDate.slice(0, 10)} - ${g.endDate.slice(0, 10)}`,
      cell: (g) => (
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-muted-foreground" />
          {format(parseISO(g.startDate), "dd-MMM")} - {format(parseISO(g.endDate), "dd-MMM-yy")}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      sortValue: (g) => g.status,
      cell: (g) => <StatusBadge label={g.status} status={g.status} />,
    },
    {
      key: "held",
      header: "Rooms held",
      align: "center",
      className: "font-semibold text-foreground",
      sortValue: (g) => g.totalRoomsHeld,
      cell: (g) => g.totalRoomsHeld,
    },
    {
      key: "picked",
      header: "Picked up",
      align: "center",
      sortValue: pickedUpCount,
      cell: (g) => (
        <div className="flex items-center justify-center gap-1.5 font-semibold text-foreground">
          <UserCheck className="w-4 h-4" />
          {pickedUpCount(g)}
        </div>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      // The row already opens the group — the button must not trigger it twice.
      cell: (g) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Link href={groupUrl(g)}>
            <Button variant="outline" size="sm">Manage</Button>
          </Link>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Group Blocks"
        hint="Manage blocks of rooms for weddings, corporate events, and tours."
        className="max-md:flex-col max-md:items-stretch max-md:gap-3"
        actions={
          <Link href={`/e/${slug}/dashboard/groups/new`} className="max-md:w-full">
            <Button className="flex items-center gap-2 max-md:w-full">
              <Plus className="w-4 h-4" />
              New group block
            </Button>
          </Link>
        }
      />

      <div>
        <FilterBar
          className="mb-3"
          search={{ value: search, onChange: setSearch, placeholder: "Group name or code…" }}
          activeCount={term ? 1 : 0}
          onClear={clearSearch}
        />
        {/* Desktop-only: the phone always gets cards. */}
        <div className="mb-3 hidden justify-end md:flex">
          <div className="flex items-center rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => chooseView("table")}
              aria-pressed={view === "table"}
              aria-label="Table view"
              className={`rounded px-2 py-1 ${view === "table" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <ListChecks className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => chooseView("card")}
              aria-pressed={view === "card"}
              aria-label="Card view"
              className={`rounded px-2 py-1 ${view === "card" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>

        {view === "card" && (
          <div className="hidden md:block">
            {loading ? (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
              </div>
            ) : loadError ? (
              <ErrorState title="Couldn't load group blocks" onRetry={fetchGroups} />
            ) : shown.length === 0 ? (
              <EmptyState
                icon={Users}
                title={groups.length === 0 ? "No group blocks found" : "No groups match your search"}
                description={groups.length === 0 ? "Create a block to reserve inventory for an event." : undefined}
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {shown.map((g) => {
                  const held = g.totalRoomsHeld
                  const picked = pickedUpCount(g)
                  return (
                    <div
                      key={g.id}
                      className="flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-elevation-1 transition-colors hover:bg-muted/30"
                      onClick={() => router.push(groupUrl(g))}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-lg font-semibold text-foreground">{g.name}</div>
                          <div className="mt-0.5 font-mono text-xs text-muted-foreground">{g.code}</div>
                        </div>
                        <StatusBadge label={g.status} status={g.status} className="shrink-0" />
                      </div>
                      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
                        <span className="flex items-center gap-2 text-foreground">
                          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                          {format(parseISO(g.startDate), "dd MMM")} → {format(parseISO(g.endDate), "dd MMM yy")}
                        </span>
                        <span className="flex items-center gap-1.5 font-semibold text-foreground" title="Rooms picked up / held">
                          <UserCheck className="h-4 w-4" />
                          {picked}
                          <span className="font-normal text-muted-foreground">/ {held} rooms</span>
                        </span>
                      </div>
                      <div className="flex items-end justify-between gap-3">
                        <div className="min-w-0 flex-1"><BadgeStrip badges={groupBadges(g, today)} /></div>
                        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                          <Link href={groupUrl(g)}><Button variant="outline" size="sm">Manage</Button></Link>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <ListTable
          rows={shown}
          columns={columns}
          rowKey={(g) => g.id}
          rowHref={groupUrl}
          loading={loading}
          error={loadError}
          onRetry={fetchGroups}
          empty={
            groups.length === 0
              ? { icon: Users, title: "No group blocks found", description: "Create a block to reserve inventory for an event." }
              : { icon: Users, title: "No groups match your search" }
          }
          // Phones keep the cards sitting on the page, as before — no box around them.
          className={`max-md:border-0 max-md:bg-transparent ${view === "card" ? "md:hidden" : ""}`}
          mobile={
            <MobileCardList>
              {shown.map((group) => (
                <MobileCard
                  key={group.id}
                  title={group.name}
                  subtitle={<span className="font-mono font-bold">{group.code}</span>}
                  badge={<StatusBadge label={group.status} status={group.status} />}
                  meta={[
                    {
                      label: "Dates",
                      value: `${format(parseISO(group.startDate), "dd-MMM")} - ${format(parseISO(group.endDate), "dd-MMM-yy")}`,
                      wide: true,
                    },
                    { label: "Rooms held", value: group.totalRoomsHeld },
                    {
                      label: "Picked up",
                      value: (
                        <span className="flex items-center gap-1.5">
                          <UserCheck className="w-4 h-4" /> {pickedUpCount(group)}
                        </span>
                      ),
                    },
                  ]}
                  onClick={() => router.push(groupUrl(group))}
                >
                  <BadgeStrip badges={groupBadges(group, today)} />
                </MobileCard>
              ))}
            </MobileCardList>
          }
        />
      </div>
    </div>
  )
}
