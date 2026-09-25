"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useProperty } from "@/components/providers/property-provider"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { History, Search, Settings2 } from "@/components/icons"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { INPUT_SEARCH } from "@/lib/input-presets"
import { MODULES, MODULE_LABELS } from "@/lib/modules"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { PageHeader } from "@/components/ui/page-header"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { FilterBar } from "@/components/ui/filter-bar"
import { useUrlState } from "@/lib/use-url-state"

type LogEntry = {
  id: string
  userName: string | null
  userEmail: string | null
  isSupport: boolean
  module: string
  action: string
  entityType: string | null
  description: string
  createdAt: string
}

const PAGE_SIZE = 50
const ALL = "__all__"

// AUTH isn't an RBAC module but is a filterable log source (login/logout events).
const FILTER_MODULES: { value: string; label: string }[] = [
  { value: "AUTH", label: "Authentication" },
  ...MODULES.map((m) => ({ value: m, label: MODULE_LABELS[m] })),
]
const MODULE_VALUES = [ALL, ...FILTER_MODULES.map((m) => m.value)]

const moduleLabel = (m: string) => (m === "AUTH" ? "Authentication" : (MODULE_LABELS as Record<string, string>)[m] ?? m)

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })

const userLabel = (e: LogEntry) => e.userName ?? e.userEmail ?? "—"

const ACTION_BADGE_CLASS: Record<string, string> = {
  DELETE: "border-destructive text-destructive",
  VOID: "border-destructive text-destructive",
  LOGIN_FAILED: "border-destructive text-destructive",
  CREATE: "border-success text-success",
  LOGIN: "border-success text-success",
}

// A text filter kept in the URL: the box is local state for instant typing, the URL (and
// so the fetch) follows 300 ms after the last keystroke, and a URL change that didn't come
// from typing (Back/Forward) flows back into the box.
function useDebouncedUrlText(key: string) {
  const [urlValue, setUrlValue] = useUrlState<string>(key, "")
  const [value, setValue] = useState(urlValue)
  const lastWritten = useRef(urlValue)
  useEffect(() => {
    if (urlValue !== lastWritten.current) {
      lastWritten.current = urlValue
      setValue(urlValue)
    }
  }, [urlValue])
  useEffect(() => {
    const next = value.trim()
    if (next === lastWritten.current) return
    const t = setTimeout(() => {
      lastWritten.current = next
      setUrlValue(next)
    }, 300)
    return () => clearTimeout(t)
  }, [value, setUrlValue])
  const clear = useCallback(() => {
    lastWritten.current = ""
    setValue("")
  }, [])
  return { value, setValue, urlValue, clear }
}

// useUrlState reads the query string — the page needs a Suspense boundary.
export default function ActivityLogPage() {
  return (
    <Suspense>
      <ActivityLog />
    </Suspense>
  )
}

function ActivityLog() {
  const router = useRouter()
  const pathname = usePathname()
  const { currentProperty } = useProperty()
  const accentColor = currentProperty?.bannerColor

  const [entries, setEntries] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  // Filters live in the URL (DESKTOP_PLAN D3) so a refresh or a shared link keeps them.
  const [moduleFilter, setModuleFilter] = useUrlState<string>("module", ALL, MODULE_VALUES)
  const action = useDebouncedUrlText("action")
  const search = useDebouncedUrlText("q")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const activeFilterCount = (moduleFilter !== ALL ? 1 : 0) + (action.urlValue ? 1 : 0)

  // Only the newest request may write the list — a slow answer to an older filter is dropped.
  const requestId = useRef(0)
  const fetchEntries = useCallback(
    async (offset: number, replace: boolean) => {
      const id = ++requestId.current
      setLoading(true)
      setLoadError(false)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
        if (moduleFilter !== ALL) params.set("module", moduleFilter)
        if (action.urlValue) params.set("action", action.urlValue.toUpperCase())
        if (search.urlValue) params.set("q", search.urlValue)
        const res = await fetch(`/api/activity-log?${params}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (id !== requestId.current) return
        setTotal(data.total)
        setEntries((prev) => (replace ? data.entries : [...prev, ...data.entries]))
      } catch {
        if (id === requestId.current) setLoadError(true)
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [moduleFilter, action.urlValue, search.urlValue]
  )

  useEffect(() => {
    fetchEntries(0, true)
  }, [fetchEntries])

  const clearFilters = () => {
    action.clear()
    search.clear()
    // One URL write for all three (three separate replaces would race each other).
    const sp = new URLSearchParams(window.location.search)
    sp.delete("module")
    sp.delete("action")
    sp.delete("q")
    const qs = sp.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const moduleSelect = (triggerClass: string) => (
    <Select value={moduleFilter} onValueChange={(v) => setModuleFilter(v ?? ALL)}>
      <SelectTrigger className={triggerClass} aria-label="Module">
        {/* Select.Value shows the raw VALUE unless given a formatter — the "all" option
            rendered as "__all__". */}
        <SelectValue placeholder="All modules">
          {(v) => (v === ALL ? "All modules" : FILTER_MODULES.find((m) => m.value === v)?.label ?? String(v))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All modules</SelectItem>
        {FILTER_MODULES.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  // Rows carry the entity type but not its id, so they are not links (nothing to open).
  const columns: ListColumn<LogEntry>[] = [
    {
      key: "when",
      header: "When",
      headClassName: "w-44",
      className: "text-xs text-muted-foreground whitespace-nowrap",
      sortValue: (e) => e.createdAt,
      csv: (e) => e.createdAt,
      cell: (e) => formatWhen(e.createdAt),
    },
    {
      key: "user",
      header: "User",
      headClassName: "w-48",
      sortValue: userLabel,
      cell: (e) => (
        <>
          <div className="text-sm">{userLabel(e)}</div>
          {e.isSupport && (
            <Badge variant="outline" className="text-xs border-warning text-warning">
              Osta Support
            </Badge>
          )}
        </>
      ),
    },
    {
      key: "module",
      header: "Module",
      headClassName: "w-36",
      className: "text-xs text-muted-foreground",
      sortValue: (e) => moduleLabel(e.module),
      cell: (e) => moduleLabel(e.module),
    },
    {
      key: "action",
      header: "Action",
      headClassName: "w-32",
      sortValue: (e) => e.action,
      cell: (e) => (
        <Badge variant="outline" className={cn("text-xs", ACTION_BADGE_CLASS[e.action])}>
          {e.action}
        </Badge>
      ),
    },
    {
      key: "description",
      header: "Description",
      className: "text-sm",
      csv: (e) => e.description,
      cell: (e) => e.description,
    },
  ]

  return (
    <div className="space-y-6">
      <div
        className={cn(accentColor && "border-l-4 pl-4")}
        style={accentColor ? { borderLeftColor: accentColor } : undefined}
      >
        <PageHeader
          title="Activity Log"
          hint="Who did what, when — every create, change, deletion, and sign-in across the enterprise. Read-only."
        />
      </div>

      {/* Phones: search inline, module/action filters in a bottom sheet. */}
      <div className="flex items-center gap-2 md:hidden">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            {...INPUT_SEARCH}
            className="w-full pl-8"
            placeholder="Search descriptions..."
            value={search.value}
            onChange={(e) => search.setValue(e.target.value)}
          />
        </div>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger
            render={
              <Button variant="outline" className="shrink-0">
                <Settings2 className="mr-2 h-4 w-4" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            }
          />
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filter activity</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-4 p-4">
              {moduleSelect("w-full")}
              <Input
                className="w-full"
                placeholder="Action (e.g. DELETE)"
                autoCapitalize="characters"
                value={action.value}
                onChange={(e) => action.setValue(e.target.value)}
              />
              <Button onClick={() => setFiltersOpen(false)}>Show {total} entr{total === 1 ? "y" : "ies"}</Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div>
        <FilterBar
          className="mb-3 max-md:hidden"
          search={{ value: search.value, onChange: search.setValue, placeholder: "Search descriptions…" }}
          activeCount={activeFilterCount + (search.urlValue ? 1 : 0)}
          onClear={clearFilters}
        >
          {moduleSelect("w-48")}
          <Input
            className="w-40"
            placeholder="Action (e.g. DELETE)"
            aria-label="Action"
            value={action.value}
            onChange={(e) => action.setValue(e.target.value)}
          />
        </FilterBar>

        <ListTable
          rows={entries}
          columns={columns}
          rowKey={(e) => e.id}
          total={total}
          loading={loading}
          error={loadError}
          onRetry={() => fetchEntries(0, true)}
          empty={{ icon: History, title: activeFilterCount + (search.urlValue ? 1 : 0) > 0 ? "No activity matches these filters" : "No activity recorded yet" }}
          exportName="activity-log"
          // Phones keep the cards sitting on the page, as before — no box around them.
          className="max-md:border-0 max-md:bg-transparent"
          mobile={
            // One card per entry — what happened first, then who · where · when.
            <MobileCardList>
              {entries.map((e) => (
                <MobileCard
                  key={e.id}
                  title={<span className="font-medium">{e.description}</span>}
                  badge={
                    <Badge variant="outline" className={cn("text-[10px]", ACTION_BADGE_CLASS[e.action])}>
                      {e.action}
                    </Badge>
                  }
                  subtitle={
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-foreground">{userLabel(e)}</span>
                      {e.isSupport && (
                        <Badge variant="outline" className="text-xs border-warning text-warning">
                          Osta Support
                        </Badge>
                      )}
                      <span aria-hidden>·</span>
                      <span>{moduleLabel(e.module)}</span>
                      {/* Its own line — a wrapped "·" would dangle. */}
                      <span className="basis-full whitespace-nowrap">{formatWhen(e.createdAt)}</span>
                    </span>
                  }
                />
              ))}
            </MobileCardList>
          }
        />
      </div>

      {entries.length < total && !loadError && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loading} onClick={() => fetchEntries(entries.length, false)}>
            {loading ? "Loading..." : `Load more (${total - entries.length} older)`}
          </Button>
        </div>
      )}
    </div>
  )
}
