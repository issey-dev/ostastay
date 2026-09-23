"use client"

import { parseDateKey, toDateKey, todayKey } from "@/lib/date-only"
import { useCallback, useEffect, useMemo, useState } from "react"
import { FileText, FileSpreadsheet, FileType, Loader2, AlertTriangle, Eye, RefreshCw, X } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { DatePicker } from "@/components/ui/date-picker"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { useProperty } from "@/components/providers/property-provider"
import { InfoHint } from "@/components/ui/info-hint"
import { ReportDocument } from "@/components/reports/report-document"
import type { ReportPreview } from "@/lib/reports/types"

type Param = {
  key: string
  label: string
  type: "date" | "dateRange" | "select" | "multiSelect" | "boolean"
  required?: boolean
  help?: string
  options?: { label: string; value: string }[]
  optionSource?: string
  defaultToday?: boolean
}
type ReportMeta = { key: string; module: string; name: string; description: string; params: Param[] }
type Catalog = { modules: { module: string; label: string }[]; reports: ReportMeta[] }


export default function ReportsPage() {
  const { currentProperty } = useProperty()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [selected, setSelected] = useState<ReportMeta | null>(null)
  const [values, setValues] = useState<Record<string, any>>({})
  const [dynOptions, setDynOptions] = useState<Record<string, { label: string; value: string }[]>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The on-screen preview, and the exact request it was built from — so a parameter
  // change after previewing is flagged instead of silently showing stale numbers.
  const [preview, setPreview] = useState<ReportPreview | null>(null)
  const [previewFor, setPreviewFor] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/reports/catalog").then((r) => (r.ok ? r.json() : null)).then(setCatalog).catch(console.error)
  }, [])

  const selectReport = useCallback((r: ReportMeta) => {
    setSelected(r)
    setError(null)
    setPreview(null)
    setPreviewFor(null)
    // "Today" for a report is the property's BUSINESS date (what the server defaults to
    // as well), not the computer's calendar — they differ until Night Audit rolls.
    const today = currentProperty?.businessDate ? toDateKey(parseDateKey(currentProperty.businessDate)!) : todayKey()
    const init: Record<string, any> = {}
    for (const p of r.params) {
      if (p.type === "date") init[p.key] = p.defaultToday ? today : ""
      else if (p.type === "dateRange") init[p.key] = p.defaultToday ? { from: today, to: today } : { from: "", to: "" }
      else if (p.type === "multiSelect") init[p.key] = []
      else if (p.type === "boolean") init[p.key] = false
      else init[p.key] = ""
    }
    setValues(init)
    // Load dynamic option sources.
    for (const p of r.params) {
      if (p.optionSource) {
        fetch(`/api/reports/options?source=${p.optionSource}`)
          .then((res) => (res.ok ? res.json() : { options: [] }))
          .then((d) => setDynOptions((prev) => ({ ...prev, [p.key]: d.options ?? [] })))
          .catch(() => {})
      }
    }
  }, [currentProperty])

  const grouped = useMemo(() => {
    if (!catalog) return []
    return catalog.modules
      .map((m) => ({ ...m, reports: catalog.reports.filter((r) => r.module === m.module) }))
      .filter((g) => g.reports.length > 0)
  }, [catalog])

  const requestKey = selected ? JSON.stringify({ key: selected.key, values }) : null
  const previewStale = !!preview && previewFor !== requestKey

  const runPreview = async () => {
    if (!selected) return
    setBusy("preview")
    setError(null)
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: selected.key, format: "json", params: values }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error || "Failed to build the preview.")
        return
      }
      setPreview(j as ReportPreview)
      setPreviewFor(requestKey)
      // Bring the preview into view on smaller screens, where it lands below the fold.
      requestAnimationFrame(() => document.getElementById("report-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }))
    } catch {
      setError("Unexpected error building the preview.")
    } finally {
      setBusy(null)
    }
  }

  const generate = async (format: "pdf" | "xlsx" | "csv") => {
    if (!selected) return
    setBusy(format)
    setError(null)
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: selected.key, format, params: values }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error || "Failed to generate the report.")
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") || ""
      const match = disposition.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || `${selected.key}.${format}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError("Unexpected error generating the report.")
    } finally {
      setBusy(null)
    }
  }

  const setVal = (key: string, v: any) => setValues((prev) => ({ ...prev, [key]: v }))

  if (!catalog) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
          Reports
          <InfoHint label="Reports">
            Generate operational and financial reports as PDF, Excel, or CSV{currentProperty ? ` for ${currentProperty.name}` : ""}.
          </InfoHint>
        </h2>
      </div>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        {/* Catalog */}
        <div className="space-y-5">
          {grouped.map((g) => (
            <div key={g.module}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{g.label}</div>
              <div className="space-y-1">
                {g.reports.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => selectReport(r)}
                    className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                      selected?.key === r.key ? "bg-muted font-medium text-foreground" : "hover:bg-muted/60 text-muted-foreground"
                    }`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Parameter panel */}
        <div className="rounded-xl border border-border bg-card p-6 min-h-[300px]">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground py-16">
              <FileText className="w-10 h-10 mb-3 opacity-40" />
              <p>Select a report to set its parameters and generate it.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold">{selected.name}</h3>
                <p className="text-sm text-muted-foreground">{selected.description}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {selected.params.map((p) => (
                  <div key={p.key} className="space-y-1.5">
                    <Label className="text-sm">{p.label}{p.required && <span className="text-destructive"> *</span>}</Label>
                    {p.type === "date" && (
                      <DatePicker value={values[p.key] || ""} onChange={(v) => setVal(p.key, v)} />
                    )}
                    {p.type === "dateRange" && (
                      <DateRangePicker
                        value={{
                          from: parseDateKey(values[p.key]?.from),
                          to: parseDateKey(values[p.key]?.to),
                        }}
                        onChange={(range) =>
                          setVal(p.key, {
                            from: range?.from ? toDateKey(range.from) : "",
                            to: range?.to ? toDateKey(range.to) : "",
                          })
                        }
                      />
                    )}
                    {p.type === "select" && (
                      <SearchableSelect
                        value={values[p.key] || ""}
                        onChange={(v) => setVal(p.key, v)}
                        placeholder="Select..."
                        options={p.options ?? dynOptions[p.key] ?? []}
                      />
                    )}
                    {p.type === "multiSelect" && (
                      <div className="rounded-md border border-border p-2 max-h-40 overflow-y-auto space-y-1">
                        {((p.options ?? dynOptions[p.key]) ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground px-1 py-0.5">No options.</p>
                        ) : (
                          (p.options ?? dynOptions[p.key] ?? []).map((o) => {
                            const checked = (values[p.key] as string[])?.includes(o.value)
                            return (
                              <label key={o.value} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!checked}
                                  onChange={(e) => {
                                    const cur = (values[p.key] as string[]) ?? []
                                    setVal(p.key, e.target.checked ? [...cur, o.value] : cur.filter((x) => x !== o.value))
                                  }}
                                />
                                {o.label}
                              </label>
                            )
                          })
                        )}
                      </div>
                    )}
                    {p.type === "boolean" && (
                      <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
                        <input type="checkbox" checked={!!values[p.key]} onChange={(e) => setVal(p.key, e.target.checked)} />
                        {p.help || "Enabled"}
                      </label>
                    )}
                    {p.help && p.type !== "boolean" && <p className="text-xs text-muted-foreground">{p.help}</p>}
                  </div>
                ))}
              </div>

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive-muted p-3 text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button onClick={runPreview} disabled={!!busy}>
                  {busy === "preview" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />} Preview
                </Button>
                <Button variant="outline" onClick={() => generate("pdf")} disabled={!!busy}>
                  {busy === "pdf" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />} PDF
                </Button>
                <Button variant="outline" onClick={() => generate("xlsx")} disabled={!!busy}>
                  {busy === "xlsx" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-2" />} Excel
                </Button>
                <Button variant="outline" onClick={() => generate("csv")} disabled={!!busy}>
                  {busy === "csv" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileType className="w-4 h-4 mr-2" />} CSV
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {preview && selected && (
        <section id="report-preview" aria-label="Report preview" className="scroll-mt-4 rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div className="mr-auto min-w-0">
              <h3 className="truncate text-sm font-semibold">Preview · {preview.result.title}</h3>
              <p className={previewStale ? "text-xs text-warning" : "text-xs text-muted-foreground"}>
                {previewStale ? "Parameters changed since this preview — refresh to see the new figures." : "This is exactly what the PDF will contain."}
              </p>
            </div>
            {previewStale && (
              <Button size="sm" variant="outline" onClick={runPreview} disabled={!!busy}>
                <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
              </Button>
            )}
            <Button size="sm" onClick={() => generate("pdf")} disabled={!!busy}>
              {busy === "pdf" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileText className="w-4 h-4 mr-1.5" />} Download PDF
            </Button>
            <Button size="sm" variant="ghost" aria-label="Close preview" onClick={() => { setPreview(null); setPreviewFor(null) }}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          {/* The report is paper: a white sheet on the muted canvas, scrollable both ways
              so a wide landscape report never squeezes. */}
          <div className="max-h-[75vh] overflow-auto bg-muted/50 p-3 sm:p-6">
            <div className={`mx-auto rounded-md bg-white p-6 shadow-sm ring-1 ring-foreground/5 sm:p-10 ${preview.result.columns.length > 6 ? "min-w-[900px] max-w-[1100px]" : "min-w-[640px] max-w-[800px]"}`}>
              <ReportDocument result={preview.result} branding={preview.branding} />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
