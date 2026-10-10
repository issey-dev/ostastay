"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronRight, Clock, FileText, Search, Star } from "@/components/icons"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"

// Choosing a report: a grouped, searchable list that is always on screen beside the report
// on a desktop (so switching report is one click, not two dropdowns), and a single
// searchable select on tablets and phones.

export type CatalogueReport = { key: string; module: string; name: string; description: string }
export type CatalogueModule = { module: string; label: string }

export function ReportCatalogue({
  modules,
  reports,
  selectedKey,
  recent,
  favorites,
  onToggleFavorite,
  onSelect,
}: {
  modules: CatalogueModule[]
  reports: CatalogueReport[]
  selectedKey: string | null
  /** Keys of the reports this person ran most recently, newest first. */
  recent: string[]
  /** Keys of the reports this person starred. */
  favorites: string[]
  onToggleFavorite: (key: string) => void
  onSelect: (key: string) => void
}) {
  const [q, setQ] = useState("")
  // Groups start folded; a search unfolds whatever matches.
  const [open, setOpen] = useState<Set<string>>(new Set())
  const needle = q.trim().toLowerCase()

  const sections = useMemo(() => {
    const match = (r: CatalogueReport) => !needle || `${r.name} ${r.description}`.toLowerCase().includes(needle)
    const byModule = modules
      .map((m) => ({ ...m, items: reports.filter((r) => r.module === m.module && match(r)) }))
      .filter((m) => m.items.length > 0)
    const pick = (keys: string[]) => keys.map((k) => reports.find((r) => r.key === k)).filter((r): r is CatalogueReport => !!r)
    const recents = needle ? [] : pick(recent).slice(0, 3)
    const favs = needle ? [] : pick(favorites)
    return { byModule, recents, favs }
  }, [modules, reports, recent, favorites, needle])

  const groupLabel = Object.fromEntries(modules.map((m) => [m.module, m.label]))

  return (
    <>
      {/* Tablet / phone: one searchable select, grouped. */}
      <div className="lg:hidden">
        <SearchableSelect
          searchable
          value={selectedKey ?? ""}
          onChange={onSelect}
          placeholder="Choose a report…"
          searchPlaceholder="Search reports…"
          emptyText="No report by that name."
          options={modules.flatMap((m) =>
            reports.filter((r) => r.module === m.module).map((r) => ({ label: r.name, value: r.key, group: groupLabel[m.module] }))
          )}
        />
      </div>

      {/* Desktop: the rail. */}
      <nav aria-label="Reports" className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-4 space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a report" className="pl-8" aria-label="Find a report" />
          </div>
          <div className="max-h-[calc(100dvh-10rem)] space-y-4 overflow-y-auto rounded-2xl bg-card p-2 shadow-elevation-1 ring-1 ring-foreground/5">
            {sections.favs.length > 0 && (
              <Section label="Favorites" icon={<Star className="h-3 w-3" />}>
                {sections.favs.map((r) => (
                  <Item key={`fav-${r.key}`} report={r} active={r.key === selectedKey} starred onSelect={onSelect} onToggleFavorite={onToggleFavorite} />
                ))}
              </Section>
            )}
            {sections.recents.length > 0 && (
              <Section label="Recent" icon={<Clock className="h-3 w-3" />}>
                {sections.recents.map((r) => (
                  <Item key={`recent-${r.key}`} report={r} active={r.key === selectedKey} starred={favorites.includes(r.key)} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />
                ))}
              </Section>
            )}
            {sections.byModule.map((m) => {
              const expanded = !!needle || open.has(m.module)
              const holdsActive = m.items.some((r) => r.key === selectedKey)
              return (
                <div key={m.module}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    disabled={!!needle}
                    onClick={() => setOpen((prev) => { const n = new Set(prev); if (n.has(m.module)) n.delete(m.module); else n.add(m.module); return n })}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:text-muted-foreground"
                  >
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <span className="flex-1">{m.label}</span>
                    {holdsActive && !expanded && <span aria-label="Contains the open report" className="h-1.5 w-1.5 rounded-full bg-primary" />}
                    <span className="font-normal tabular-nums">{m.items.length}</span>
                  </button>
                  {expanded && (
                    <ul className="mt-0.5 space-y-0.5">
                      {m.items.map((r) => (
                        <Item key={r.key} report={r} active={r.key === selectedKey} starred={favorites.includes(r.key)} onSelect={onSelect} onToggleFavorite={onToggleFavorite} />
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
            {sections.byModule.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">No report by that name.</p>}
          </div>
        </div>
      </nav>
    </>
  )
}

function Section({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {icon}
        {label}
      </h3>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  )
}

function Item({
  report,
  active,
  starred,
  onSelect,
  onToggleFavorite,
}: {
  report: CatalogueReport
  active: boolean
  starred: boolean
  onSelect: (key: string) => void
  onToggleFavorite: (key: string) => void
}) {
  return (
    <li className="group/item relative">
      <button
        type="button"
        onClick={() => onSelect(report.key)}
        aria-current={active ? "page" : undefined}
        title={report.description}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg py-1.5 pr-8 pl-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          active ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-muted"
        )}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className="truncate">{report.name}</span>
      </button>
      <button
        type="button"
        onClick={() => onToggleFavorite(report.key)}
        aria-pressed={starred}
        aria-label={starred ? `Remove ${report.name} from favorites` : `Add ${report.name} to favorites`}
        className={cn(
          "absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          starred ? "text-primary opacity-100" : "text-muted-foreground opacity-0 group-hover/item:opacity-100 hover:text-foreground"
        )}
      >
        <Star className={cn("h-3.5 w-3.5", starred && "fill-current")} />
      </button>
    </li>
  )
}
