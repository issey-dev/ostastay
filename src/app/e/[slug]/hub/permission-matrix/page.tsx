"use client"

import { useEffect, useState } from "react"
import { resolveStationeryFontClass } from "@/lib/stationery-fonts"
import { PrintDocumentShell, PrintLoading, PrintError } from "@/components/print/print-document-shell"
import { StationeryPage, StationeryHeader, StationerySection, StationeryFooter } from "@/components/print/stationery/blocks"

// Permission Matrix — a printable answer to "who can do what here".
//
// Laid out with MODULES DOWN and ROLES ACROSS, which is the transpose of what the plan
// first sketched. With 20 modules the other way round is 20 columns on A4 portrait and
// unreadable; roles are far fewer, so this way each column stays wide enough to read and
// the page grows downward, which printing handles and sideways scrolling does not.
//
// Each cell shows V C U D — filled when granted, faint when not — so a whole role reads
// as a vertical stripe and a gap is obvious at a glance.

type Grant = { module: string; view: boolean; create: boolean; update: boolean; delete: boolean }
type Role = {
  id: string
  name: string
  isSystem: boolean
  holders: { id: string; name: string; email: string; jobFunction: string | null }[]
  grants: Grant[]
}
type ModuleRow = { code: string; label: string; scope: "PROPERTY" | "HUB" }

const ACTIONS: { key: keyof Omit<Grant, "module">; letter: string; title: string }[] = [
  { key: "view", letter: "V", title: "View" },
  { key: "create", letter: "C", title: "Create" },
  { key: "update", letter: "U", title: "Update" },
  { key: "delete", letter: "D", title: "Delete" },
]

export default function PermissionMatrixPage() {
  const [data, setData] = useState<{
    brand: any
    enterpriseName: string
    modules: ModuleRow[]
    roles: Role[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/hub/permission-matrix-data")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Failed to load")
        return r.json()
      })
      .then((d) => {
        setData(d)
        setTimeout(() => window.print(), 800)
      })
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <PrintError message={error} />
  if (!data) return <PrintLoading label="Preparing the permission matrix..." />

  const { brand, enterpriseName, modules, roles } = data
  // resolveStationeryBrand already resolved the typeface — reading `stationeryFont` off
  // the brand would have found nothing and silently fallen back to the default.
  const fontClass: string = brand?.fontClass ?? resolveStationeryFontClass(null)
  const grantOf = (role: Role, moduleCode: string) => role.grants.find((g) => g.module === moduleCode)

  const scopes: { key: "PROPERTY" | "HUB"; label: string }[] = [
    { key: "PROPERTY", label: "Property modules" },
    { key: "HUB", label: "Hub modules (enterprise-wide)" },
  ]

  return (
    <PrintDocumentShell
      previewLabel={`Permission Matrix — ${enterpriseName}`}
      fontClassName={fontClass}
      screenThemeAware
      orientation="landscape"
    >
      <StationeryPage fontClass={fontClass} screenThemeAware orientation="landscape">
        {brand && (
          <StationeryHeader
            brand={brand}
            eyebrow="Access control"
            title="Permission Matrix"
            meta={[
              { label: "Enterprise", value: enterpriseName },
              { label: "Date", value: new Date().toLocaleDateString() },
            ]}
            screenThemeAware
          />
        )}

        {scopes.map((scope) => {
          const rows = modules.filter((m) => m.scope === scope.key)
          if (rows.length === 0) return null
          return (
            <StationerySection key={scope.key} title={scope.label} screenThemeAware>
              {/* Wide content must scroll in its own box on screen; in print it simply
                  lays out at page width. */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[11px] sm:text-xs">
                  <thead>
                    <tr className="border-b-2 border-border print:border-slate-300">
                      <th className="w-[22%] sm:w-[28%] py-1 text-left font-semibold text-muted-foreground print:text-slate-500">Module</th>
                      {roles.map((r) => (
                        <th key={r.id} className="min-w-[60px] py-1 text-center font-semibold text-foreground print:text-slate-700">
                          {r.name}
                          {r.isSystem && <span className="block text-[9px] font-normal text-muted-foreground print:text-slate-400">system</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.code} className="border-b border-border print:border-slate-100">
                        <td className="py-1 pr-2 text-foreground print:text-slate-800">{m.label}</td>
                        {roles.map((r) => {
                          const g = grantOf(r, m.code)
                          const none = !g || (!g.view && !g.create && !g.update && !g.delete)
                          return (
                            <td key={r.id} className="py-1 text-center">
                              {none ? (
                                <span className="text-muted-foreground print:text-slate-300">—</span>
                              ) : (
                                <span className="inline-flex gap-[3px] font-mono tabular-nums">
                                  {ACTIONS.map((a) => (
                                    <span
                                      key={a.key}
                                      title={a.title}
                                      className={g![a.key] ? "font-bold text-foreground print:text-slate-900" : "text-muted-foreground print:text-slate-300"}
                                    >
                                      {a.letter}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </StationerySection>
          )
        })}

        <p className="mb-4 text-[10px] text-muted-foreground print:text-slate-500">
          V view · C create · U update · D delete. Bold letters are granted; faint are not.
          A person holding more than one role has the COMBINATION of their grants — read
          across every role they hold, not just one.
        </p>

        {/* The half that makes this an audit rather than a spec: who actually holds each
            role today. */}
        <StationerySection title="Who holds each role" screenThemeAware>
          <table className="w-full border-collapse text-[11px] sm:text-xs">
            <thead>
              <tr className="border-b-2 border-border print:border-slate-300">
                <th className="w-[30%] sm:w-[22%] py-1 text-left font-semibold text-muted-foreground print:text-slate-500">Role</th>
                <th className="py-1 text-left font-semibold text-muted-foreground print:text-slate-500">Active holders</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} className="border-b border-border print:border-slate-100">
                  <td className="py-1 pr-2 align-top font-medium text-foreground print:text-slate-800">{r.name}</td>
                  <td className="py-1 text-foreground print:text-slate-700">
                    {r.holders.length === 0 ? (
                      <span className="text-muted-foreground print:text-slate-400">Nobody</span>
                    ) : (
                      r.holders.map((h) => h.name).join(", ")
                    )}
                    {r.holders.length > 0 && (
                      <span className="text-muted-foreground print:text-slate-400"> ({r.holders.length})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StationerySection>

        <StationeryFooter
          paymentInfo={undefined}
          terms={undefined}
          note={`Generated ${new Date().toLocaleString()} · Access shown is what each role grants; a person's effective access is the combination of every role they hold.`}
          screenThemeAware
        />
      </StationeryPage>
    </PrintDocumentShell>
  )
}
