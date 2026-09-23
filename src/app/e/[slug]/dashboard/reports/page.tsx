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
import { Checkbox } from "@/components/ui/checkbox"
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
  // Two-step picker: a report group narrows the report list; picking a report (from any
  // group) also sets the group, so the two dropdowns always agree.
  const [group, setGroup] = useState("")
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
    setGroup(r.module)
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

  const groupLabel = useMemo<Record<string, string>>(
    () => Object.fromEntries((catalog?.modules ?? []).map((m) => [m.module, m.label])),
    [catalog]
  )

  const groupOptions = useMemo(
    () => [
      // "" = no group: the Report dropdown then lists everything, under group headings.
      { label: "All groups", value: "" },
      ...(catalog?.modules ?? [])
        .filter((m) => catalog!.reports.some((r) => r.module === m.module))
        .map((m) => ({ label: m.label, value: m.module })),
    ],
    [catalog]
  )

  // With a group chosen, only its reports; without one, every report under its group's
  // heading, so a user who knows the report's name can go straight to it.
  const reportOptions = useMemo(() => {
    if (!catalog) return []
    const order = catalog.modules.map((m) => m.module)
    return [...catalog.reports]
      .filter((r) => !group || r.module === group)
      .sort((a, b) => order.indexOf(a.module) - order.indexOf(b.module))
      .map((r) => ({ label: r.name, value: r.key, group: group ? undefined : groupLabel[r.module] }))
  }, [catalog, group, groupLabel])

  const changeGroup = (g: string) => {
    setGroup(g)
    // Widening to "All groups" keeps the current report; switching to another group drops it.
    if (g && selected && selected.module !== g) {
      setSelected(null)
      setPreview(null)
      setPreviewFor(null)
      setError(null)
    }
  }

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

  const paramOptions = (p: Param) => p.options ?? dynOptions[p.key] ?? []

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

      <section aria-label="Report selection" className="rounded-xl border border-border bg-card">
        {/* Step 1 — which report */}
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm">Report group</Label>
            <SearchableSelect
              searchable
              value={group}
              onChange={changeGroup}
              placeholder="All groups"
              searchPlaceholder="Search groups..."
              options={groupOptions}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Report</Label>
            <SearchableSelect
              searchable
              value={selected?.key ?? ""}
              onChange={(key) => {
                const r = catalog.reports.find((x) => x.key === key)
                if (r) selectReport(r)
              }}
              placeholder={group ? `Select a ${groupLabel[group] ?? ""} report...` : "Select a report..."}
              searchPlaceholder="Search reports..."
              emptyText="No report by that name."
              options={reportOptions}
            />
          </div>
        </div>

        {!selected ? (
          <div className="flex items-center gap-3 border-t border-border px-5 py-6 text-sm text-muted-foreground">
            <FileText className="h-5 w-5 shrink-0 opacity-50" />
            Choose a report to set its parameters, then preview or extract it.
          </div>
        ) : (
          /* Step 2 — its parameters and the actions */
          <div className="space-y-5 border-t border-border p-5">
            <div>
              <h3 className="text-base font-semibold">{selected.name}</h3>
              <p className="text-sm text-muted-foreground">{selected.description}</p>
            </div>

            {selected.params.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                        options={paramOptions(p)}
                      />
                    )}
                    {p.type === "multiSelect" && (
                      <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-input p-2">
                        {paramOptions(p).length === 0 ? (
                          <p className="px-1 py-0.5 text-xs text-muted-foreground">No options.</p>
                        ) : (
                          paramOptions(p).map((o) => {
                            const cur = (values[p.key] as string[]) ?? []
                            return (
                              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-muted">
                                <Checkbox
                                  checked={cur.includes(o.value)}
                                  onCheckedChange={(on) => setVal(p.key, on ? [...cur, o.value] : cur.filter((x) => x !== o.value))}
                                />
                                {o.label}
                              </label>
                            )
                          })
                        )}
                      </div>
                    )}
                    {p.type === "boolean" && (
                      <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm">
                        <Checkbox checked={!!values[p.key]} onCheckedChange={(on) => setVal(p.key, !!on)} />
                        {p.help || "Enabled"}
                      </label>
                    )}
                    {p.help && p.type !== "boolean" && <p className="text-xs text-muted-foreground">{p.help}</p>}
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive-muted p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button onClick={runPreview} disabled={!!busy}>
                {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />} Preview
              </Button>
              <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
              <span className="text-xs text-muted-foreground">Extract as</span>
              <Button variant="outline" onClick={() => generate("pdf")} disabled={!!busy}>
                {busy === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />} PDF
              </Button>
              <Button variant="outline" onClick={() => generate("xlsx")} disabled={!!busy}>
                {busy === "xlsx" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />} Excel
              </Button>
              <Button variant="outline" onClick={() => generate("csv")} disabled={!!busy}>
                {busy === "csv" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileType className="mr-2 h-4 w-4" />} CSV
              </Button>
            </div>
          </div>
        )}
      </section>

      {preview && selected && (
        <section id="report-preview" aria-label="Report preview" className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div className="mr-auto min-w-0">
              <h3 className="truncate text-sm font-semibold">Preview · {preview.result.title}</h3>
              <p className={previewStale ? "text-xs text-warning" : "text-xs text-muted-foreground"}>
                {previewStale ? "Parameters changed since this preview — refresh to see the new figures." : "This is exactly what the PDF will contain."}
              </p>
            </div>
            {previewStale && (
              <Button size="sm" variant="outline" onClick={runPreview} disabled={!!busy}>
                <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
              </Button>
            )}
            <Button size="sm" onClick={() => generate("pdf")} disabled={!!busy}>
              {busy === "pdf" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />} Download PDF
            </Button>
            <Button size="sm" variant="ghost" aria-label="Close preview" onClick={() => { setPreview(null); setPreviewFor(null) }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {/* The paper spans the page container. It scrolls sideways only on a phone,
              where a many-column table would otherwise be crushed unreadable. */}
          <div className="overflow-x-auto bg-muted/50 p-3 sm:p-5">
            <div className="min-w-[720px] rounded-md bg-white p-6 shadow-sm ring-1 ring-foreground/5 sm:p-8 md:min-w-0">
              <ReportDocument result={preview.result} branding={preview.branding} />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
