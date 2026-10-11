"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { parseDateKey, toDateKey, todayKey } from "@/lib/date-only"
import { Download, FileText, Printer, RefreshCw } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { MobileActionBar } from "@/components/ui/mobile"
import { useProperty } from "@/components/providers/property-provider"
import { toast } from "@/lib/toast"
import { ReportCatalogue } from "@/components/reports/report-catalogue"
import { ReportFilterBar, defaultParamValues, type ParamValues, type ReportParam } from "@/components/reports/report-filter-bar"
import { ReportKpiStrip, ReportVisualPanels } from "@/components/reports/report-visuals"
import { ReportTable } from "@/components/reports/report-table"
import { DownloadDialog, type DownloadFormat } from "@/components/reports/download-dialog"
import type { ExportOptions } from "@/lib/reports/export-options"
import type { ReportPreview } from "@/lib/reports/types"

type ReportMeta = { key: string; module: string; name: string; description: string; params: ReportParam[] }
type Catalog = { modules: { module: string; label: string }[]; reports: ReportMeta[] }

const RECENT_KEY = "reports.recent.v1"
const readRecent = (): string[] => {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]")
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}

const FAV_KEY = "reports.favorites.v1"
const readFavorites = (): string[] => {
  try {
    const v = JSON.parse(window.localStorage.getItem(FAV_KEY) ?? "[]")
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}

// useSearchParams needs a Suspense boundary above it.
export default function ReportsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <ReportsContent />
    </Suspense>
  )
}

function ReportsContent() {
  const { currentProperty } = useProperty()
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()

  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogError, setCatalogError] = useState(false)
  const [dynOptions, setDynOptions] = useState<Record<string, { label: string; value: string }[]>>({})
  const [preview, setPreview] = useState<ReportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [busy, setBusy] = useState<DownloadFormat | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  // The selected report and its parameters live in the URL (?report=…&q=…), so a view can be
  // bookmarked, shared, refreshed and navigated Back to. `q` is the parameter object as JSON.
  const reportKey = search.get("report") ?? ""
  const urlParams = search.get("q")
  const selected = useMemo(() => catalog?.reports.find((r) => r.key === reportKey) ?? null, [catalog, reportKey])
  const values = useRef<ParamValues>({})
  const runId = useRef(0)

  const setUrl = useCallback(
    (key: string, params: ParamValues | null) => {
      const sp = new URLSearchParams(window.location.search)
      if (key) sp.set("report", key)
      else sp.delete("report")
      if (params && Object.keys(params).length) sp.set("q", JSON.stringify(params))
      else sp.delete("q")
      const qs = sp.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname]
  )

  useEffect(() => {
    fetch("/api/reports/catalog")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setCatalog)
      .catch(() => setCatalogError(true))
    setRecent(readRecent())
    setFavorites(readFavorites())
  }, [])

  // "Today" for a report is the property's BUSINESS date (what the server defaults to as
  // well), not the computer's calendar — they differ until Night Audit rolls.
  const today = currentProperty?.businessDate ? toDateKey(parseDateKey(currentProperty.businessDate)!) : todayKey()

  const initialValues = useMemo<ParamValues>(() => {
    if (!selected) return {}
    const base = defaultParamValues(selected.params, today)
    if (urlParams) {
      try {
        const parsed = JSON.parse(urlParams)
        if (parsed && typeof parsed === "object") return { ...base, ...parsed }
      } catch {
        /* a hand-edited link — fall back to the defaults */
      }
    }
    return base
    // The URL is only read when the report changes; later edits come from the form itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key, today])

  // Load dynamic option sources (outlets, room types …) for the selected report.
  useEffect(() => {
    if (!selected) return
    for (const p of selected.params) {
      if (!p.optionSource) continue
      fetch(`/api/reports/options?source=${p.optionSource}`)
        .then((res) => (res.ok ? res.json() : { options: [] }))
        .then((d) => setDynOptions((prev) => ({ ...prev, [p.key]: d.options ?? [] })))
        .catch(() => {})
    }
  }, [selected])

  const run = useCallback(
    async (key: string, params: ParamValues) => {
      const id = ++runId.current
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/reports/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, format: "json", params }),
        })
        const j = await res.json().catch(() => ({}))
        if (id !== runId.current) return // a newer run superseded this one
        if (!res.ok) {
          setError(j.error || "Couldn't build this report.")
          return
        }
        setPreview(j as ReportPreview)
        setUpdatedAt(new Date())
        setRecent((prev) => {
          const next = [key, ...prev.filter((k) => k !== key)].slice(0, 3)
          try {
            window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
          } catch {
            /* remembering recents is a convenience only */
          }
          return next
        })
      } catch {
        if (id === runId.current) setError("Couldn't reach the server. Check your connection and try again.")
      } finally {
        if (id === runId.current) setLoading(false)
      }
    },
    []
  )

  const toggleFavorite = (key: string) =>
    setFavorites((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      try {
        window.localStorage.setItem(FAV_KEY, JSON.stringify(next))
      } catch {
        /* favorites are a convenience; without storage they just do not persist */
      }
      return next
    })

  const selectReport = (key: string) => {
    if (key === reportKey) return
    runId.current++ // drop anything still in flight for the previous report
    setPreview(null)
    setError(null)
    setUrl(key, null)
  }

  // The filter bar reports valid values: mirror them into the URL and run the report.
  const onParams = useCallback(
    (v: ParamValues) => {
      if (!selected) return
      values.current = v
      setUrl(selected.key, v)
      run(selected.key, v)
    },
    [selected, setUrl, run]
  )

  const requestFile = async (format: DownloadFormat | "pdf", options?: Partial<ExportOptions>) => {
    const res = await fetch("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: selected!.key, format, params: values.current, options }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || "Couldn't generate the file.")
    }
    const blob = await res.blob()
    const filename = (res.headers.get("Content-Disposition") || "").match(/filename="?([^"]+)"?/)?.[1] || `${selected!.key}.${format}`
    return { blob, filename }
  }

  const download = async (format: DownloadFormat, options: ExportOptions): Promise<boolean> => {
    if (!selected) return false
    setBusy(format)
    try {
      const { blob, filename } = await requestFile(format, options)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success("Download started", { description: filename })
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate the file.")
      return false
    } finally {
      setBusy(null)
    }
  }

  const print = async () => {
    if (!selected) return
    setBusy("pdf")
    try {
      const { blob } = await requestFile("pdf")
      const url = URL.createObjectURL(blob)
      if (!window.open(url, "_blank")) toast.error("Your browser blocked the print window. Allow pop-ups for this site, or use Download as.")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't prepare the print view.")
    } finally {
      setBusy(null)
    }
  }

  if (catalogError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Daily Reports" />
        <ErrorState title="Couldn't load the reports" description="Refresh the page to try again." />
      </div>
    )
  }
  if (!catalog) {
    return (
      <div className="space-y-6">
        <PageHeader title="Daily Reports" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    )
  }

  const ready = !!preview && preview.result && !error
  const hasVisuals = !!preview && ((preview.result.summary?.length ?? 0) > 0 || (preview.result.visuals?.length ?? 0) > 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Reports"
        hint="Operational and financial reports for the property. Pick a report, set its dates, and read it here — download it as PDF, Excel, delimited text or CSV when you need a file."
        actions={
          selected && (
            <>
              <Button variant="ghost" onClick={() => onParams(values.current)} disabled={loading} aria-label="Refresh report" className="max-md:hidden">
                <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Button variant="outline" onClick={print} disabled={!ready || !!busy} className="max-md:hidden">
                <Printer className="mr-1.5 h-4 w-4" /> Print
              </Button>
              <Button onClick={() => setDownloadOpen(true)} disabled={!ready} className="max-md:hidden">
                <Download className="mr-1.5 h-4 w-4" /> Download as…
              </Button>
            </>
          )
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <ReportCatalogue
          modules={catalog.modules}
          reports={catalog.reports}
          selectedKey={selected?.key ?? null}
          recent={recent}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onSelect={selectReport}
        />

        <div className="min-w-0 flex-1 space-y-4">
          {!selected ? (
            <Landing catalog={catalog} onSelect={selectReport} />
          ) : (
            <>
              <div>
                <h2 className="text-lg font-semibold text-foreground">{selected.name}</h2>
                <p className="text-sm text-muted-foreground">{selected.description}</p>
              </div>

              <ReportFilterBar
                key={selected.key}
                params={selected.params}
                initialValues={initialValues}
                dynOptions={dynOptions}
                busy={loading}
                onChange={onParams}
              />

              {error ? (
                <ErrorState title="Couldn't build this report" description={error} onRetry={() => onParams(values.current)} />
              ) : !preview ? (
                <div className="space-y-4" aria-busy="true">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
                  </div>
                  <Skeleton className="h-56 rounded-2xl" />
                  <Skeleton className="h-72 rounded-2xl" />
                </div>
              ) : (
                <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
                  <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                    {preview.result.subtitle && <span className="font-medium text-foreground">{preview.result.subtitle}</span>}
                    <span>{preview.branding.propertyName}</span>
                    {preview.branding.currency && <span>Amounts in {preview.branding.currency}</span>}
                    {updatedAt && <span>Updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                  </div>
                  {preview.result.note && <p className="text-xs italic text-muted-foreground">{preview.result.note}</p>}
                  <ReportKpiStrip items={preview.result.summary ?? []} currency={preview.branding.currency} />
                  <ReportVisualPanels visuals={preview.result.visuals ?? []} />
                  <ReportTable result={preview.result} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Phones and tablets: Refresh and Download stay within thumb reach while reading. */}
      {selected && (
        <MobileActionBar>
          <Button variant="outline" size="icon" onClick={() => onParams(values.current)} disabled={loading} aria-label="Refresh report">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button className="flex-1" onClick={() => setDownloadOpen(true)} disabled={!ready}>
            <Download className="mr-1.5 h-4 w-4" /> Download as…
          </Button>
        </MobileActionBar>
      )}

      {selected && (
        <DownloadDialog
          open={downloadOpen}
          onOpenChange={setDownloadOpen}
          reportKey={selected.key}
          hasVisuals={hasVisuals}
          busy={busy}
          onDownload={download}
        />
      )}
    </div>
  )
}

// Nothing chosen yet: the whole catalogue as cards, so the reports can be browsed rather than
// remembered.
function Landing({ catalog, onSelect }: { catalog: Catalog; onSelect: (key: string) => void }) {
  // On a phone each group starts folded (a wall of 22 cards is no way to browse); from a
  // tablet up the groups are always open.
  const [open, setOpen] = useState<Set<string>>(new Set())
  const groups = catalog.modules.map((m) => ({ ...m, items: catalog.reports.filter((r) => r.module === m.module) })).filter((m) => m.items.length)
  if (groups.length === 0) return <EmptyState icon={FileText} title="No reports available" description="Your role doesn't include any reports yet." />
  return (
    <div className="space-y-6 max-md:space-y-2">
      {groups.map((g) => {
        const expanded = open.has(g.module)
        return (
          <section key={g.module} aria-label={g.label}>
            {/* Phones: a tappable, foldable header. Tablet and up: a plain heading. */}
            <h2 className="md:hidden">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen((prev) => { const n = new Set(prev); if (n.has(g.module)) n.delete(g.module); else n.add(g.module); return n })}
                className="flex min-h-12 w-full items-center justify-between rounded-xl bg-card px-4 text-sm font-semibold text-foreground shadow-elevation-1 ring-1 ring-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span>{g.label}</span>
                <span className="text-xs font-normal tabular-nums text-muted-foreground">{g.items.length} {expanded ? "▴" : "▾"}</span>
              </button>
            </h2>
            <h2 className="mb-2 hidden text-xs font-semibold tracking-wider text-muted-foreground uppercase md:block">{g.label}</h2>
            <div className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-3 max-md:mt-2 ${expanded ? "" : "max-md:hidden"}`}>
              {g.items.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => onSelect(r.key)}
                  className="group flex flex-col gap-1 rounded-2xl bg-card p-4 text-left shadow-elevation-1 ring-1 ring-foreground/5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elevation-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <FileText className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                    {r.name}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{r.description}</span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
