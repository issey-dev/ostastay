"use client"

import { useCallback, useEffect, useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { History, Search, Settings2 } from "@/components/icons"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { INPUT_SEARCH } from "@/lib/input-presets"
import { InfoHint } from "@/components/ui/info-hint"
import { MODULES, MODULE_LABELS } from "@/lib/modules"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"

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

const moduleLabel = (m: string) => (m === "AUTH" ? "Authentication" : (MODULE_LABELS as Record<string, string>)[m] ?? m)

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })

const ACTION_BADGE_CLASS: Record<string, string> = {
  DELETE: "border-destructive text-destructive",
  VOID: "border-destructive text-destructive",
  LOGIN_FAILED: "border-destructive text-destructive",
  CREATE: "border-success text-success",
  LOGIN: "border-success text-success",
}

export default function ActivityLogPage() {
  const { currentProperty } = useProperty()
  const accentColor = currentProperty?.bannerColor

  const [entries, setEntries] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [moduleFilter, setModuleFilter] = useState<string>(ALL)
  const [actionFilter, setActionFilter] = useState("")
  const [search, setSearch] = useState("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const activeFilterCount = (moduleFilter !== ALL ? 1 : 0) + (actionFilter.trim() ? 1 : 0)

  const fetchEntries = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true)
      setLoadError(false)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
        if (moduleFilter !== ALL) params.set("module", moduleFilter)
        if (actionFilter.trim()) params.set("action", actionFilter.trim().toUpperCase())
        if (search.trim()) params.set("q", search.trim())
        const res = await fetch(`/api/activity-log?${params}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        setTotal(data.total)
        setEntries((prev) => (replace ? data.entries : [...prev, ...data.entries]))
      } catch {
        setLoadError(true)
      } finally {
        setLoading(false)
      }
    },
    [moduleFilter, actionFilter, search]
  )

  useEffect(() => {
    fetchEntries(0, true)
  }, [fetchEntries])

  return (
    <div className="p-4 md:p-8 space-y-6 max-md:p-0">
      <div
        className={cn("space-y-1", accentColor && "border-l-4 pl-4")}
        style={accentColor ? { borderLeftColor: accentColor } : undefined}
      >
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            Activity Log
            <InfoHint label="Activity Log">Who did what, when — every create, change, deletion, and sign-in across the enterprise. Read-only.</InfoHint>
          </h2>
      </div>

      {/* Phones: search inline, module/action filters in a bottom sheet. */}
      <div className="flex items-center gap-2 md:hidden">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            {...INPUT_SEARCH}
            className="w-full pl-8"
            placeholder="Search descriptions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
              <Select value={moduleFilter} onValueChange={(v) => setModuleFilter(v ?? ALL)}>
                <SelectTrigger className="w-full">
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
              <Input
                className="w-full"
                placeholder="Action (e.g. DELETE)"
                autoCapitalize="characters"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              />
              <Button onClick={() => setFiltersOpen(false)}>Show {total} entr{total === 1 ? "y" : "ies"}</Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="hidden md:flex flex-wrap items-center gap-3">
        <Select value={moduleFilter} onValueChange={(v) => setModuleFilter(v ?? ALL)}>
          <SelectTrigger className="w-48">
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
        <Input
          className="w-40"
          placeholder="Action (e.g. DELETE)"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="w-64 pl-8"
            placeholder="Search descriptions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-sm text-muted-foreground ml-auto">
          {total} entr{total === 1 ? "y" : "ies"}
        </span>
      </div>

      {/* Phones: one card per entry — what happened first, then who · where · when. */}
      <div className="space-y-2 md:hidden">
      <p className="text-xs text-muted-foreground">
        {total} entr{total === 1 ? "y" : "ies"}
      </p>
      <MobileCardList>
        {loading && entries.length === 0 ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
        ) : loadError ? (
          <ErrorState title="Couldn't load activity" onRetry={() => fetchEntries(0, true)} />
        ) : entries.length === 0 ? (
          <EmptyState icon={History} title="No activity recorded yet" className="py-10" />
        ) : (
          entries.map((e) => (
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
                  <span className="font-medium text-foreground">{e.userName ?? e.userEmail ?? "—"}</span>
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
          ))
        )}
      </MobileCardList>
      </div>

      <div className="hidden md:block bg-card rounded-xl border shadow-sm overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="w-44">When</TableHead>
              <TableHead className="w-48">User</TableHead>
              <TableHead className="w-36">Module</TableHead>
              <TableHead className="w-32">Action</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && entries.length === 0 ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={5} className="py-0">
                  <ErrorState title="Couldn't load activity" onRetry={() => fetchEntries(0, true)} />
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-0">
                  <EmptyState icon={History} title="No activity recorded yet" />
                </TableCell>
              </TableRow>
            ) : (
              entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{e.userName ?? e.userEmail ?? "—"}</div>
                    {e.isSupport && (
                      <Badge variant="outline" className="text-xs border-warning text-warning">
                        Osta Support
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {e.module === "AUTH" ? "Authentication" : (MODULE_LABELS as Record<string, string>)[e.module] ?? e.module}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-xs", ACTION_BADGE_CLASS[e.action])}>
                      {e.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{e.description}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {entries.length < total && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loading} onClick={() => fetchEntries(entries.length, false)}>
            {loading ? "Loading..." : `Load more (${total - entries.length} older)`}
          </Button>
        </div>
      )}
    </div>
  )
}
