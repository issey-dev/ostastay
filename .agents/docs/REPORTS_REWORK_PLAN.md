# Daily Reports rework — v8.7 plan

Status: **BUILT in 8.7.0** (branch `release/8.7.0`) — Phases P1–P5 done, except the items under "Left open" below.
Open questions (§9) were answered by their plan defaults: charts in PDF on by default (toggle in the dialog), Excel
gets a Summary sheet, CSV is machine-readable by default with an "As printed" layout, no separate export permission,
EOD snapshots not merged, recents are `localStorage` only.

### What shipped (file map)
- Contract: `src/lib/reports/types.ts` (`insights` spec on `ReportDef`; `summary`/`visuals` on `ReportResult`), resolved by
  `src/lib/reports/insights.ts` from the report's own rows (`$group` pseudo-column = the group label). Specs live on each def in `defs/*.ts` and `transport/report.ts`.
- Files: `render/{flatten,delimited,csv,xlsx}.ts`, `export-options.ts` (Zod, shared by dialog and `/api/reports/generate`, `format: "txt"`, `options`). The Transportation board CSV keeps the old "as printed" layout on purpose.
- Screen: `src/components/reports/{report-catalogue,report-filter-bar,report-visuals,report-table,download-dialog}.tsx`, page `reports/page.tsx` (URL state `?report=&q=`).
- Paper: `report-document.tsx` + `report-visuals-print.tsx` (PDF carries KPIs/charts). `render/pdf.ts` (pdf-lib fallback) does NOT draw charts.
- Phones/tablets: first chart + "show more", cards 15 at a time, `MobileActionBar` (Refresh + Download as…), Print hidden below `md`.
- Docs: `/docs/operations/daily-reports`, release notes 8.7.0. Tests: `tests/business-rules/report-export.test.ts`.

### Also fixed on this branch (found by the production build)
`next build` failed its route type check because `api/charge-codes/route.ts` and `api/outlets/route.ts` exported non-handler
constants (Next only allows HTTP handlers + route config there). Moved to `src/lib/charge-code-include.ts` and
`src/lib/outlet-options.ts`. Rule: never export helpers/constants from a `route.ts`.

### Left open
- Row click-through (`rowLink`, §3.1) — report rows carry confirmation numbers, not ids; needs ids added per report.
- Native Excel charts (Summary sheet has the numbers only); Windows-1252 maps the common characters only.
- Docs screenshot for the new page (`npm run docs:demo` then `npm run docs:shots`) and `npm run mobile:audit` baseline for `/reports`.
- Download audit trail in the activity log.
Trigger: client feedback — Daily Reports feels "old school"; wants more visual components, a
preview that feels native to the app, and a **Download as** modal (PDF / Excel / Delimited
text / CSV) instead of the row of format buttons.

## 1. What exists today (verified in code)

| Piece | Where | Notes |
|---|---|---|
| Page | `src/app/e/[slug]/dashboard/reports/page.tsx` | One client component: group + report dropdowns → parameter form → `Preview`, `PDF`, `Excel`, `CSV` buttons. Preview opens *below* the form. Hidden on phones (`DesktopOnlyNotice`). |
| Engine | `src/lib/reports/{registry,run,engine,types,params,format}.ts` | One `ReportDef` per report (`params` + `run()` → `ReportResult`). ~21 reports in `defs/` (front-desk, reservations, revenue, financial, housekeeping) + transport report. |
| Result shape | `ReportResult` = `{title, subtitle, columns, rows \| groups, totals, note}` | **Table-only.** No notion of KPIs or charts, so the UI has nothing visual to show. |
| Preview | `src/components/reports/report-document.tsx` | A white "A4 paper" table, shared with the print page that Chrome turns into the PDF. Deliberately palette-fixed (`--print-*`), so it looks like a document pasted into the app, not part of it. |
| Renderers | `render/{pdf,xlsx,csv,green-tax-xlsx}.ts`; `/api/reports/generate` (`format: json\|pdf\|xlsx\|csv`) | PDF = headless Chrome of `/reports/print?r=…` with pdf-lib fallback. CSV prepends a title/subtitle/blank line and group label rows — **not machine-readable**. |
| Visual kit already in app | `src/components/dashboard/{charts,tiles}.tsx`, `ui/stat-tile.tsx` | `ColumnChart`, `LineChart`, `DonutChart`, `RankedBars`, `StackedBar`, `Sparkline`, `Meter`, `ChartTableView`, `StatTile`, `Panel`, `DataRow`. Dependency-free SVG on `--series-*` tokens, light/dark safe. **Reuse; add no chart library.** |
| Related | `/dashboard/financials/night-audit/reports` (EOD snapshots), `DESKTOP_PLAN` row "Reports split from EOD archive" | Out of scope for 8.7 except a link/tab (see §9). |

### Root causes of the "old school" feel
1. The preview is a *print simulation*, not a screen view — fixed-colour paper, no interactivity.
2. Reports return only a table; no summary figures or charts exist in the data contract.
3. Selection UI is a form-first, two-dropdown flow; nothing to browse or discover.
4. Format buttons are always visible and mean "download" and "preview" are separate, equal-weight steps.
5. Parameters/selected report are not in the URL (can't bookmark, share, or survive refresh) — same finding as DESKTOP_PLAN.
6. Phones get no preview at all.

## 2. Target experience

```
┌ Daily Reports ─────────────────────────────  [Download as ▾]  [Print] ┐
│ Report catalogue (left rail, grouped, searchable, recent/pinned)       │
│ ┌────────────┐  ┌ Filter bar: params inline (date, range, outlets…) ┐ │
│ │ Front Desk │  │ [Arrival date ▾]            [Run]  auto-refresh ☑ │ │
│ │  Arrivals ●│  └───────────────────────────────────────────────────┘ │
│ │  Departures│  KPI strip:  [Arrivals 42] [VIP 6] [Pax 118] [Rev 12k] │
│ │ Revenue …  │  Charts row: [ column chart ] [ donut ]                │
│ └────────────┘  Data table: sortable, searchable, sticky head, groups │
│                  collapsible, totals row, click-through to reservation │
└────────────────────────────────────────────────────────────────────────┘
```
Download as modal: **PDF · Excel (.xlsx) · Delimited text (.txt) · CSV (.csv)** + options.

## 3. Scope — what changes

### 3.1 Data contract (the enabler) — `src/lib/reports/types.ts`
Extend `ReportResult` **additively** (every existing report keeps working unchanged):
```ts
summary?: ReportKpi[]          // { key, label, value, format, delta?, tone?, hint? }
visuals?: ReportVisual[]       // discriminated union, see below
rowLink?: { column: string; href: (row) => string }  // click-through (reservation, folio, room)
```
`ReportVisual` = `{ type: "column"|"line"|"donut"|"ranked"|"stacked"|"meter"; title; data…; sourceColumns }`.
Rules:
- Visuals are **derived from the same rows** the table shows, so screen, PDF and Excel can never disagree.
  Prefer small helpers in `defs/_shared.ts` (`kpisFromTotals`, `breakdownBy(rows, col)`, `trendBy(rows, dateCol, valueCol)`)
  so most reports gain visuals in a few lines rather than bespoke code.
- Totals-row figures become KPIs automatically when a report doesn't declare its own `summary`.
- Respect chart rules already baked in `charts.tsx` (no dual axis, ≤4 series hues, `ChartTableView` twin).

### 3.2 Per-report visual treatment (first pass)
| Report | KPIs | Visual |
|---|---|---|
| fd-arrivals / departures / in-house | count, VIP, pax, balance due (departures) | status donut; arrivals by room type ranked bars |
| fd-guest-events | events by type | stacked bar per day |
| res-availability | avg occ %, peak day, sold nights | occupancy line chart + sellout days highlighted |
| res-entered / cancellations / deposits / traces | counts, deposit total | trend column by day; cancel vs no-show donut |
| rev-history-forecast | Rev, ADR, RevPAR, Occ % | line chart (Occ/ADR as **stacked plots**, not dual-axis) |
| rev-nationality / profile-production | top-N share | ranked bars + "Other" fold |
| fin-cashier-summary / outlet-sales / folio-tax / gst | received/refunded/net, tax split | payment-method donut; outlet ranked bars; tax stacked bar |
| fin-transaction-journal | debits/credits/net | type breakdown |
| fin-green-tax / -missing, hk-*, transport | counts, exceptions | exceptions panel (rows needing attention) for *-missing |
Pure data-extract reports (Green Tax MIRA sheet) get **KPIs only, no charts**; their Excel template stays untouched (`renderXlsx` override).

### 3.3 Page rebuild — `reports/page.tsx` → split into components under `src/components/reports/`
- `ReportCatalogue` — left rail (desktop) / sheet (phone): grouped, searchable, "Recently run" (per user, `localStorage` convenience only), keyboard nav. Replaces the two dropdowns.
- `ReportFilterBar` — params rendered inline in a compact bar (same `DatePicker`/`DateRangePicker`/`SearchableSelect`/Checkbox rules per AGENTS.md); **Zod + React Hook Form** per FORM_VALIDATION_STANDARD (the current page uses raw `useState`, which violates APP STANDARD 001).
- `ReportView` — the in-app preview, **themed** (card surfaces, `StatTile` strip, chart `Panel`s, table). Light/dark follows the app. Skeleton while loading; `EmptyState`/`ErrorState` components that already exist.
- `ReportTable` — sortable columns, quick filter box, sticky header, collapsible groups, sticky totals, density toggle, row click-through. Virtualise only if a report exceeds ~500 rows (Guest Events / Journal) — measure first.
- `DownloadAsDialog` — see §4.
- Toolbar: `Download as…`, `Print`, `Refresh`, "Updated 10:42" stamp, stale-parameter chip (reuse the existing `previewStale` logic).
- **Run model:** report auto-runs on select with defaults (business date) and re-runs on filter change (debounced); remove the separate Preview step.
- **URL state:** `?report=fd-arrivals&date=2026-10-10…` so views are bookmarkable/shareable; use `PageHeader` + shared feedback/toast patterns from DESKTOP_PLAN (no blocking success modals — download triggers a toast).
- **Phones (MOBILE_PLAN):** remove the "desktop-only preview" notice; KPI tiles stack 2-up, charts full width, table → `MobileCardList`; Download dialog is a bottom sheet (`DialogContent mobile="sheet"`). Desktop must not change visually — run `npm run mobile:audit`.

### 3.4 Print/PDF fidelity — keep `ReportDocument`
`ReportDocument` stays the **print/PDF** layout (paper, `--print-*` tokens), so PDFs are unchanged in look. Changes:
- Add an optional KPI strip and charts section to it (static SVG, print palette) so the PDF carries the visuals the screen shows. Charts are server-renderable SVG → fine for Chrome PDF.
- A "Include charts" toggle in the Download dialog (default on; off = table-only PDF for compact archival).
- The on-screen view is **no longer** this component; the page stops claiming "exactly what the PDF will contain" and instead says "PDF is formatted for print."

## 4. "Download as" modal

Single primary button → dialog with four format cards (icon, name, one-line purpose, file-size hint):

| Format | Output | Notes |
|---|---|---|
| **PDF** | Existing Chrome renderer → pdf-lib fallback | Options: orientation (Auto / Portrait / Landscape), include charts, include KPI summary. |
| **Excel (.xlsx)** | Existing `renderXlsx` / report-specific override | Options: include summary sheet, include "Charts" sheet (native Excel charts via exceljs if feasible; otherwise data only — decide in Phase 3). Green Tax keeps its fixed template (options hidden). |
| **Delimited text (.txt)** | **New** `render/delimited.ts` | Options: delimiter (Tab default / Pipe `\|` / Semicolon / Custom 1 char), text qualifier, header row on/off, encoding (UTF-8 / UTF-8 BOM / Windows-1252), line ending (CRLF/LF). Intended for import into other systems (accounting, MIRA, PMS integrations). |
| **CSV (.csv)** | Existing, **cleaned** | Same options subset (delimiter fixed to comma, BOM option so Excel opens UTF-8 correctly). |

Behaviour:
- Remembers last format/options per user (`localStorage`, wrapped in try/catch).
- Shows filename preview (`fd-arrivals-2026-10-10.pdf`), a spinner on the chosen card, success toast, inline error on failure; stays open on error.
- "Machine-readable" (default for CSV/TXT): **flat, one header row, no title/subtitle/blank lines, no subtotal/group label rows**; group name becomes a leading column; raw (unformatted) numbers and ISO dates. Toggle "Presentation layout" (current behaviour: title block, group rows, subtotals, formatted values) for people who rely on the old shape. **Behaviour change to flag in release notes** — existing CSV consumers may have scripts depending on the old preamble; keep the old layout reachable.
- API: `POST /api/reports/generate` gains `format: "txt"` and an `options` object validated with Zod (delimiter allow-list, single-char custom delimiter, no injection into filenames). Add CSV/formula-injection guard (prefix `'` to cells starting `= + - @`) on CSV/TXT/XLSX string cells — currently unguarded.
- `Content-Disposition` filename sanitised via existing `SAFE()`.

## 5. API / backend changes
1. `types.ts` — new optional fields (§3.1); `ReportFormat` adds `"txt"`.
2. `render/delimited.ts` (new), refactor `render/csv.ts` to share a flat-rows helper (`flattenResult(result, {presentation})`).
3. `engine.ts` / `generate/route.ts` — `txt` format, `options`, MIME `text/plain; charset=utf-8`, BOM/encoding handling (Windows-1252 via `iconv-lite` only if not already a dependency — otherwise offer UTF-8 / UTF-8 BOM only).
4. `render/xlsx.ts` — optional Summary sheet from `summary`/`visuals`.
5. `defs/*` — add `summary`/`visuals`/`rowLink` per §3.2, using shared helpers. Do reports in batches by module.
6. Permission model unchanged (`requirePermission(ctx,"REPORTS","view")`). Consider a distinct `REPORTS:export` action only if the owner wants download restricted separately — **open question Q3**.
7. Audit: log report downloads (who/what/params/format) to the activity log — currently none (verify; add if absent).

## 6. Phases (each independently shippable on `release/8.7.0`)

| Phase | Deliverable | Rough size |
|---|---|---|
| **P0** | Plan sign-off; answer open questions; screenshot current UI as baseline | — |
| **P1** | Contract + shared helpers; **Download as modal**; `txt` + cleaned CSV; formula-injection guard; tests for renderers | M |
| **P2** | New page shell: catalogue rail, inline filter bar (Zod+RHF), URL state, auto-run, themed `ReportView` with KPI strip + `ReportTable` (sort/search/click-through) — all reports still table-only + auto KPIs from totals | L |
| **P3** | Visuals per report (§3.2) in batches: Front Desk → Reservations → Revenue → Financial → Housekeeping/Transport; PDF/Excel carry visuals | L |
| **P4** | Phone layout via MOBILE_PLAN primitives; `mobile:audit`; dark-mode pass; a11y (chart table twins, keyboard nav) | M |
| **P5** | Docs & release: operations guide page under `src/app/docs/operations` (new "Daily Reports" page + screenshots via `docs:shots`), release notes entry for 8.7.0 in `releases.ts`, `docs:pdf`, `docs:check`, bump `package.json`, update TODO.md / DECISIONS.md | S |

## 7. Testing
- Unit: `flattenResult`, delimited/CSV escaping (qualifier, embedded delimiter/newline, BOM, CRLF), injection guard, option validation.
- Snapshot per report: `summary`/`visuals` sums equal table totals (guards screen-vs-file drift).
- Existing browser click-through suite (8.4.3): add select report → auto-run → open Download → each format returns correct MIME/filename.
- `npm run mobile:audit` (desktop pixel diff must only change on `/reports`), dark-mode screenshots, `npm run lint`/typecheck.
- Manual: large report (Journal, ~1k rows) performance; Green Tax XLSX still byte-identical in structure.

## 8. Risks
- **Screen/PDF divergence** once the preview is no longer `ReportDocument` → mitigated by shared data (visuals derived from rows) and the snapshot test above.
- **CSV behaviour change** breaks existing consumers → keep "Presentation layout" toggle, call out in release notes.
- **Puppeteer PDFs with charts** — SVG fine, but verify page-break behaviour (`report-group`, `report-totals` classes) and landscape detection (`reportIsLandscape` counts columns only).
- **Scope creep** — 21+ reports × visuals. Ship P1/P2 first; visuals are incremental and optional per report.
- **Next.js in this repo has breaking changes** — read `node_modules/next/dist/docs/` for searchParams/routing before touching the page (AGENTS.md rule).

## 9. Open questions for the app owner
1. **Charts in PDF/Excel** — include by default, or screen-only? (Plan assumes PDF yes/toggle, Excel Summary sheet.)
2. **CSV change** — OK to make machine-readable by default, with the old layout behind a toggle?
3. **Export permission** — should downloading need its own right (`REPORTS:export`) separate from viewing?
4. **Delimited text** — which delimiters/encodings do clients actually need (Tab/Pipe? Windows-1252 for legacy systems)? Any fixed-width requirement?
5. **EOD archive** — merge the Night Audit "Reports" snapshot list as a "Snapshots" tab here (DESKTOP_PLAN suggestion), or leave for a later release?
6. **Scheduling/email** (e.g. email PDF every morning) — out of scope for 8.7 unless the client asks; flag as 8.8 candidate.
7. Pinned/favourite reports — per user (needs a DB column) or `localStorage` only (plan default)?

## 10. Out of scope (8.7)
Report builder / custom reports, scheduled delivery, new reports, changing report *calculations*, EOD snapshot internals.
