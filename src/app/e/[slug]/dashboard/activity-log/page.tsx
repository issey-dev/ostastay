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
import { History, Search } from "@/components/icons"
import { InfoHint } from "@/components/ui/info-hint"
import { MODULES, MODULE_LABELS } from "@/lib/modules"

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
    <div className="p-4 md:p-8 space-y-6">
      <div
        className={cn("space-y-1", accentColor && "border-l-4 pl-4")}
        style={accentColor ? { borderLeftColor: accentColor } : undefined}
      >
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            Activity Log
            <InfoHint label="Activity Log">Who did what, when — every create, change, deletion, and sign-in across the enterprise. Read-only.</InfoHint>
          </h2>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={moduleFilter} onValueChange={(v) => setModuleFilter(v ?? ALL)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All modules" />
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

      <div className="bg-card rounded-xl border shadow-sm overflow-x-auto">
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
