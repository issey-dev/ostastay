# Design / UI-UX Log

> Scope: **UI/UX and visual-design changes only** — spacing, color, typography, layout,
> component styling, responsiveness, theming. Not the multi-tenancy/RBAC retrofit (see
> [MASTER_PLAN.md](MASTER_PLAN.md) / [TODO.md](TODO.md) for that). Full rationale and the
> original audit/plan still live in [`DESIGN_PLAN.md`](DESIGN_PLAN.md) — this file is the
> running, dated log of individual fixes made on top of that plan, so a fix doesn't need
> chat history to be understood later.
>
> When you close a design/UI item, add a dated entry below (newest at the bottom).
> Keep entries short: what was wrong, root cause, what changed, which file(s).

---

## 2026-07-18

- **Global border-radius removed** — app-wide "no curves" request. `--radius: 0px` in
  `src/app/theme.css` (drives the whole `--radius-sm..4xl` scale in `globals.css` via
  `calc()`). Plus a `rounded-full` → `rounded-none` sweep across ~22 files (avatars,
  status dots, pill badges, switch track/thumb) since `rounded-full` isn't derived from
  the `--radius` token. Two hardcoded-px radii (`checkbox.tsx`, `tooltip.tsx`) fixed
  individually since `rounded-[4px]`/`rounded-[2px]` don't auto-zero either.

- **Property banner accent rescoped from Enterprise to Property** — corrected design:
  each property gets its own accent color (thin line at the top of the page), not a
  shared enterprise-wide token. See [DECISIONS.md](DECISIONS.md) "Theming & Design
  System" for the full model (`Property.bannerColor`, `PropertyBannerBar` component).

- **Controls tab bar: dead `data-state=active` selector.** Base UI's `Tabs` marks the
  active tab with a bare `data-active` attribute, not shadcn's Radix-era
  `data-state="active"` — every `data-[state=active]:...` class in
  `controls-dashboard.tsx` and `profiles/page.tsx` was a silent no-op. Fixed by
  targeting `data-active:` instead (plus matching `dark:` variants, since the base
  component's own dark-mode overrides were still winning without them).

- **Controls tab bar: full border/shadow box instead of underline-only.** Root cause:
  `<TabsList>` in both files never passed `variant="line"`, so it defaulted to
  `variant="default"` (boxed-pill), which draws `shadow-sm` on the active tab via
  `group-data-[variant=default]/tabs-list:data-active:shadow-sm` in the base
  `tabs.tsx` component. Fixed by adding `variant="line"` and simplifying
  `TAB_TRIGGER_CLASS` down to just the label-color rule — the component's own
  built-in line-variant styling already handles background/shadow/underline
  correctly, so the old manual `border-b-2 border-primary` override was redundant.

- **Card header not flush with card top edge.** `Card` (`src/components/ui/card.tsx`)
  has `py-(--card-spacing)` (16px top+bottom padding) and special-cases
  `has-data-[slot=card-footer]:pb-0` so a footer sits flush at the bottom, but had no
  matching rule for a header — every `CardHeader`'s gray band (`bg-muted/50`) started
  16px below the card's true top edge, leaving a white strip above it. Fixed by adding
  `has-data-[slot=card-header]:pt-0` alongside the existing footer rule. Verified via
  DOM measurement (`topGap: 0` on every card header on the page, light + dark).

- **Controls tab bar spacing.** Gap between the tab bar's bottom border and the content
  below felt too tight. `TabsList`'s `mb-6` → `mb-10` in `controls-dashboard.tsx`.

- **App-wide consistency sweep**, following a full UX audit of component reuse across
  every dashboard page and Controls manager. Six categories, all fixed:

  - **Page header pattern.** Dashboard pages had three competing header shapes: `h1` +
    icon-box (Housekeeping, Maintenance, POS, Groups, Night Audit), plain `h2` (most
    others), and a smaller `text-2xl` (Front Office). Also found: several pages
    (`housekeeping`, `maintenance`, `groups*`, `cashiering`, `pos`, `night-audit`,
    `reports`) wrapped their own content in a redundant `p-8`/`max-w-7xl mx-auto`/
    `max-w-5xl`/`max-w-4xl` — `layout.tsx` (`src/app/e/[slug]/dashboard/layout.tsx`)
    already provides `p-4 md:p-6 lg:p-8` + `max-w-7xl mx-auto` around every page's
    children, so those were double-padding and inconsistently narrowing content width.
    Standardized every dashboard page on `<h2 className="text-3xl font-bold
    tracking-tight">` + `<p className="text-muted-foreground">`, dropped icon-boxes,
    and removed the redundant outer wrappers (kept an intentional `max-w-*` on the few
    genuinely narrower single-column pages: `groups/new`, `night-audit`, `reports`,
    `profiles/[upid]/edit`).

  - **Status pills.** `<StatusBadge>` (`src/components/ui/status-badge.tsx`) existed but
    was used almost nowhere — every page instead called `statusMutedClasses()`/
    `toneMutedClasses()` directly and hand-rolled the pill `<span>`, causing visible
    padding/size drift. Migrated every status/priority/role pill across `reservations`,
    `groups` (list + detail), `maintenance`, `pos`, `room-manager.tsx` (also fixed a
    stray `rounded` that should've been `rounded-none`), and `users-roles-manager.tsx`
    (replaced a bespoke `getRoleBadgeColor()` switch with a `roleName → StatusTone` map
    through the same component). Extended `StatusBadge` itself with an optional `dot`
    prop (leading colored dot) so `properties-manager.tsx`'s Property status pill could
    move onto the shared component without losing that visual. Left non-pill uses of
    `toneMutedClasses` alone (whole-card tints in `room-status-card.tsx`, calendar/
    Gantt bars in `reservations/calendar/page.tsx`, button tinting) — those are a
    different, legitimate pattern, not a status label.

  - **Empty states.** `<EmptyState>` existed but was used in ~4 files; most hand-rolled
    their own icon+text block, and `reservations/page.tsx` had *both* patterns in the
    same file. Migrated every "no data" block across `housekeeping`, `groups` (list +
    detail, including the nested reservations table), `front-office` (all three
    arrival/departure/in-house tables), `pos`, `cashiering`, `reservations` (both mobile
    cards and desktop table), `profiles` (list + edit-not-found), and the Controls
    managers (`users-roles-manager`, `charge-codes-manager`, `tax-manager`,
    `dropdowns-manager`, `room-type-manager`, `room-manager` ×3, `properties-manager`,
    `folio-panel`). Left small inline one-line hints (e.g. "No Custom Tax profiles yet"
    under a form field, per-kanban-column "No tickets" in Maintenance) as plain text —
    full `EmptyState` there would be visually heavier than the compact context warrants.

  - **Loading states.** Was a three-way split: shaped `<Skeleton>`, a raw `Loader2`
    spinner (`cashiering`), and plain unstyled "Loading…" text with no placeholder
    (`front-office`, `maintenance`, `inventory`, `profiles` ×2, `reservations`,
    `groups`, and most Controls managers' tables). Standardized on `<Skeleton>`
    everywhere — full page-shape skeletons for page-level loads, 3× skeleton table rows
    for table loads.

  - **Groups tables.** `groups/page.tsx` and `groups/[id]/page.tsx` hand-rolled raw
    `<table>` markup instead of the shared `<Table>` family every other list page uses.
    Converted both to `Table`/`TableHeader`/`TableRow`/`TableCell`.

  - **"Add X" button placement.** Inconsistent across Controls managers — top-right of
    the target `CardHeader` (`room-manager.tsx`'s Buildings/Floors/Rooms sections,
    `users-roles-manager.tsx`), versus a separate, title-less row above the card
    (`properties-manager.tsx`). Moved `properties-manager.tsx`'s "Add Property" button
    into the "Property Portfolio" card's own header, next to its title, matching the
    rest. Left Tax/Charge Codes' tabs-adjacent placement as-is — different content
    shape (tabbed sub-views, no per-tab Card), not an arbitrary inconsistency.

  Verified via `tsc --noEmit`, `eslint` (design-rule count still 0), `npm run build`,
  and a live browser pass across Groups, Housekeeping, Maintenance, Front Office,
  Cashiering, Controls (Properties/Room Manager/Dropdowns), Profiles, and Reservations
  in both light and dark mode — no console errors, all new components render and
  color-resolve correctly.

- **Responsive/mobile pass** on the operational pages touched by the consistency sweep
  above. Scoped deliberately: full mobile card-stacking (matching the existing
  Reservations/Profiles/Groups pattern) for the high-traffic operational pages;
  Controls/admin manager tables were left on the shared `Table` component's built-in
  horizontal-scroll wrapper rather than card-stacked too — an acceptable minimum for
  screens mostly used on desktop, and a much smaller job than card-stacking all dozen
  of them.

  - **Front Office**: all three tabs (Arrivals/Departures/In-House) only ever rendered
    a `<Table>` with no mobile alternative — on a phone this meant a horizontally
    scrolled 4-5 column table with per-row action buttons. Added a `md:hidden` stacked
    card view per tab (guest name + trace indicator, key details, full-width action
    buttons) alongside `<Table className="hidden md:table">`, mirroring the established
    pattern.
  - **Housekeeping bulk-action floating bar**: a real overflow bug — `fixed` +
    centered via `left-1/2 -translate-x-1/2` with five unwrapped action buttons
    (Mark Clean/Inspected/Dirty, Assign, Report Issue) plus a selection badge and close
    button, no width constraint. At 375px this is far wider than the viewport, and
    because it's centered, both edges would render off-screen with no way to reach
    them. Icon-only wasn't an option (Mark Clean and Mark Inspected share the same
    icon, differentiated only by label text + tone color). Fixed by constraining the
    bar to `inset-x-4` on mobile (full width minus margins, reverting to the original
    centered fixed-width bar at `md:`) and making its content `overflow-x-auto` with
    `shrink-0` sections, so all actions stay reachable via horizontal swipe instead of
    being clipped.
  - **Groups detail page** (`groups/[id]/page.tsx`): two `grid-cols-4` stat-card grids
    (one real, one in the loading skeleton) had **no responsive breakpoint at all** —
    on mobile this squeezed four stat cards into ~90px-wide columns. Fixed to
    `grid-cols-2 lg:grid-cols-4`. Also made the page header (back button + group name +
    status badge + two action buttons, all in one unwrapped `flex justify-between` row)
    stack vertically below `sm`, and added the same `md:hidden` card view to the
    "Group Reservations (Pickups)" table.
  - **Cashiering**: the "Starting Float" row paired a `text-3xl` dollar figure with a
    `size="lg"` destructive button carrying a long label ("Close Shift (Blind Drop)")
    in one unwrapped `flex justify-between` row — a realistic crowding risk on narrow
    screens. Made it stack (`flex-col sm:flex-row`) with the button going full-width
    below `sm`.
  - **Maintenance**'s kanban board and the rest of Cashiering were already using a
    `grid-cols-1` mobile base and needed no changes.

  Verified via `tsc --noEmit`, `eslint` (design-rule count still 0), `npm run build`,
  and a live browser pass at 375×812 across Front Office, Housekeeping (including
  triggering bulk-select to inspect the floating bar), Maintenance, Cashiering, and
  Reservations — confirmed zero horizontal page overflow on every page (`document.body.
  scrollWidth === window.innerWidth`), confirmed the desktop `<Table>` is `display:
  none` and the mobile card view renders in its place below the `md` breakpoint, and
  confirmed the Housekeeping action bar is horizontally scrollable rather than clipped.

- **Controls page navigation redesign.** User-reported "doesn't work properly in
  tablet/mobile" — measured live: the 10-11 flat top-level tabs wrapped to 4 rows at
  768px and 6 rows at 375px before any content was visible, and three inner components
  (Tax Manager, Facilities Manager, Dropdowns Manager) each nested a second tab bar
  inside a card. Redesigned via a design Q&A with the user (see conversation) into:
  - **Tablet/desktop**: a vertical sidebar nav using `Tabs orientation="vertical"` —
    `src/components/ui/tabs.tsx` was already fully wired for vertical orientation with
    zero CSS changes needed (flex-column list, full-width left-aligned triggers,
    right-edge active indicator all already existed under `group-data-vertical/tabs:`
    selectors), so this was close to a one-line orientation flip plus a `w-56` width on
    the list. `variant="line"` (thin edge-indicator) kept deliberately, not the boxed
    "default" pill variant, so this primary nav stays visually distinct from the
    segmented-control-style tabs used inside individual sections.
  - **Mobile**: a genuinely new pattern (nothing like it existed elsewhere in the app)
    — a full-width tappable list of all sections, tapping one shows only that section's
    content with a back button, driven by the existing `useDeviceTier()` hook
    (`src/hooks/use-mobile.ts`, already used by the global sidebar's tablet-collapse
    behavior). Deliberately *not* built on the `Tabs` primitive — drill-down is
    navigation to a subview, not switching between simultaneously-mounted panels.
  - Licensing (Osta-internal-only) visually separated from the other sections via a
    divider + "Osta Internal" label, in both the sidebar and the mobile list.
  - A `tier === undefined` (pre-hydration) skeleton fork uses Tailwind's own `md:`
    breakpoint directly (not a JS guess) so the correct layout silhouette is present on
    first paint with zero flash.

  **Bug found and fixed along the way, not anticipated by the original plan**: Base UI
  1.6.0's `TabsPanel` exit lifecycle (`useOpenChangeComplete` → `useAnimationsFinished`)
  never completes when no CSS transition/animation is defined on the panel — so once a
  panel has been shown, its `hidden` attribute never gets reapplied when it becomes
  inactive, and every previously-visited tab's content stays rendered underneath the
  current one forever. **Reproduced with the pre-existing, unmodified horizontal
  Facilities Manager tabs too** (Buildings/Floors/Room Types/Rooms) — this is a
  wrapper-level bug in `src/components/ui/tabs.tsx`'s `TabsContent`, not something the
  vertical-nav change introduced, and it affects **any** Tabs usage in the app where a
  user switches between 2+ tabs in the same `Tabs` instance (confirmed also present in
  Tax Manager's Maldives/Custom Tax switch — not yet fixed there, see TODO.md/flagged to
  user). Fixed for the new Controls sidebar by not using `<TabsContent>`/`Panel` at all
  for content — `TabsTrigger`/`TabsList` are unaffected (their active-state is a plain
  `data-active` CSS selector, no mount/animation lifecycle), so nav/keyboard/ARIA is
  unchanged; content is rendered directly via `sections.find(s => s.key ===
  activeKey)?.render()` instead of trusting Panel's own visibility.

  Verified via `tsc --noEmit`, `eslint` (0 design-rule violations), `npm run build`
  (bundling succeeds; a pre-existing, unrelated type error in the standalone script
  `prisma/add-sharers.ts` blocks the full typecheck stage but predates this session),
  and a live browser pass: desktop (1440px) sidebar renders correctly with working
  tab-switch and correct dark-mode active-indicator colors; tablet (768px) same
  sidebar layout, confirmed no double-sidebar crowding against the global
  AppSidebar's collapsed icon-rail state; mobile (375px) list screen shows all
  sections, tapping one shows only that section plus a working back button, zero
  horizontal overflow at every step. The file was being concurrently edited by
  another agent session (adding a new "Outlets" section) during this work — merged
  cleanly with no conflict since the nav-shell changes and the new section both read
  from the same generic `sections` array. (Initially shipped with a local
  TabsContent-bypass workaround in this file specifically — superseded the same day
  by the app-wide fix below, which made the workaround unnecessary; reverted back to
  plain `TabsContent`.)

- **App-wide fix for the stale-panel Tabs bug**, following up on the Controls redesign
  above. Rather than working around it per call site, fixed it once at the source:
  `src/components/ui/tabs.tsx`'s `Tabs` now tracks the active tab value itself in a
  `TabsActiveValueContext` (mirroring whichever mode the consumer uses — controlled
  `value`/`onValueChange` or uncontrolled `defaultValue`), and `TabsContent` reads
  that context and returns `null` immediately when it isn't the active panel —
  unmounting it directly via React instead of trusting Base UI Panel's own
  hidden-once-animation-completes lifecycle (which, per the earlier entry, never
  actually completes with no CSS transition defined). `TabsTrigger`/`TabsList` are
  untouched and still render through Base UI's own Panel type internally when
  active, so full ARIA `tabpanel` semantics (`role`, `aria-labelledby`, `id`,
  `tabIndex`, `inert`) are preserved — this is a strictly better fix than the
  Controls-only workaround it replaced, which had dropped `TabsContent`/`Panel`
  entirely and lost those attributes.

  **Zero call-site changes needed** — every existing `<Tabs>`/`<TabsContent>` usage
  in the app (9 files: `controls-dashboard.tsx`, `tax-manager.tsx`,
  `facilities-manager.tsx`, `dropdowns-manager.tsx`, `folio-panel.tsx`,
  `revenue/page.tsx`, `inventory/page.tsx`, `profiles/page.tsx`,
  `front-office/page.tsx`) picked up the fix automatically. `profiles/page.tsx` was
  never affected in the first place — it uses `Tabs` purely as a trigger/state
  mechanism with a single shared table filtered by the active value, not
  `TabsContent` panels.

  Verified via `tsc --noEmit`, `eslint` (0 design-rule violations), `npm run build`,
  and a live browser pass switching between tabs (including switching *back* to a
  previously-active tab, and nested Tabs-inside-Tabs — Property Architecture's
  Buildings/Room Types switcher inside the Inventory section) on every one of the 9
  files, confirming exactly one panel's content is ever present after a switch, with
  zero console errors on a cold page load. (One false alarm during this pass: Base
  UI's own controlled/uncontrolled-mismatch dev warning appeared during live-edit
  iteration via Fast Refresh — confirmed via a genuinely fresh browser tab that this
  was stale/buffered console output from mid-edit HMR swaps, not a real issue; a cold
  load has no console errors.)

## 2026-07-19

- **Invoice redesigned to match a reference template + new Payment Receipt / Currency
  Exchange Receipt stationery**, all sharing one visual family. New
  `src/components/print/` (`print-document-shell.tsx`, `print-blocks.tsx`) extracts the
  shell (control bar + white A4-ish document container + print CSS) and presentational
  pieces (`PrintDocumentHeader`, `PrintInfoColumns`, `PrintTransactionTable`,
  `PrintTotals`, `PrintFooter`) used by all three print pages, so a glance at any one of
  them reads as the same app. Heavy display heading approximated via
  `font-black tracking-tight` on the existing font stack — no new font dependency.
  These files (plus the print pages themselves) are deliberately exempt from the
  `design/no-raw-palette-class` rule — see the existing "printed documents render as
  fixed paper" rationale already in `eslint.config.mjs`, now extended to cover them.

- **Print-chrome leak fixed.** The dashboard's `AppSidebar` and sticky header
  (`src/app/e/[slug]/dashboard/layout.tsx`) had no `print:hidden`, so printing any
  in-app document leaked the app sidebar/header into the printed output — only the
  print page's own control bar was ever hidden. Added `print:hidden` to both wrapper
  elements plus `print:p-0`/`print:max-w-none` on the content padding wrapper, so all
  three print documents (invoice, payment receipt, exchange receipt) render as clean,
  full-bleed pages. Verified via the compiled Tailwind stylesheet
  (`@media print { .print\:hidden { display: none !important } }`) and confirming the
  three chrome elements (sidebar wrapper, header block, control bar) all carry the
  class in a live DOM check.

- **Invoice charges/payments table simplified** from the old 5-6 column
  tax-breakdown layout to a plain Date / Description / Reference / Amount shape,
  per explicit user request — the Maldives tax math (Service Charge/TGST/Green Tax)
  is still computed and shown, just rolled into the `PrintTotals` block instead of
  per-line columns.

- **Invoice Settings (Controls > Reports > Invoice Design)**: added a "Payment
  Information" field group (Account Name, Account Number, IBAN, Bank Info — 4 new
  optional `EnterpriseSettings` columns) and relabeled the existing "Payment Terms"
  textarea to "Terms & Conditions" (UI copy only, same underlying
  `invoicePaymentTerms` field). Live preview updated to match. See
  [DECISIONS.md](DECISIONS.md) for the Tax/Proforma invoice and document-numbering
  rules this connects to.

- **Pre-existing hook-ordering bugs fixed in passing** in three files touched by this
  work (`folios/[id]/print/page.tsx`, `invoice-settings-manager.tsx`, and the two new
  receipt pages inherit the corrected pattern from the start): a `useEffect` called a
  `fetch*` helper function declared *below* it in the same component body. Harmless in
  practice (the `const` is bound before the effect fires post-mount) but flagged by
  `react-hooks/immutability`; reordered so the helper is declared before the effect
  that calls it. This same pattern exists elsewhere in the app (e.g. the other agent's
  confirmation-letter page) and was left alone — out of scope for this pass, not fixed
  system-wide.

## 2026-07-22

- **Neutral dark theme.** Dark mode was tinted blue (Slate ramp). Swapped every `.dark`
  surface/border/text token in `src/app/theme.css` to Tailwind's Neutral ramp (true
  grays) at the same lightness steps — `--background #0A0A0A`, `--card #171717`,
  `--secondary/muted/accent #262626`, `--border/input #404040`, `--muted-foreground
  #A3A3A3`, sidebar equivalents. Semantic status hues (success/warning/info/destructive)
  left intentional. Also fixed `--sidebar-primary-foreground` (`#fff` → `#171717`) which
  was unreadable on the now-light dark-mode primary.

- **Border→shadow / consistent-card iteration** (user-requested, explicitly revertible).
  Reduce visible border/divider usage in favor of the existing elevation+ring pattern,
  and remove the "different bg colors" look on cards:
  - **ControlsCard** (`controls/controls-card.tsx`): dropped the `bg-muted/50 border-b`
    header band + divider so header and body share one continuous card surface;
    separation now carried by spacing + the card's own `shadow-elevation-1`. Removed its
    bespoke per-property left-accent logic — now handled globally (see accent item).
  - **Card / Dialog footers** (`ui/card.tsx`, `ui/dialog.tsx`): removed the
    `border-t bg-muted/50` gray footer band (same disliked pattern); footers now blend
    with padding only.
  - **Header logo** (`ui/dashboard-header.tsx`): removed `border border-border` →
    `shadow-elevation-1`.
  - **Controls mobile nav** (`controls-dashboard.tsx`): `border` box → `bg-card
    shadow-elevation-1 ring-1 ring-foreground/5`; divider softened to `border-border/50`.
  - **Section header divider** (`controls-section-header.tsx`): `border-border` →
    `border-border/50`.
  - Deliberately left alone this pass: table row borders (functional separators in dense
    tables) and form-input borders (functional affordance). Feature pages still carry
    ~500 border usages across 70+ files — a mechanical sweep deferred as follow-up since
    this iteration may be reverted.

- **Subtle brand accent app-wide.** Previously only the top `PropertyBannerBar` line and
  Controls cards used the property's banner color. Added `PropertyAccentScope`
  (`providers/property-accent-scope.tsx`) which injects the active property's
  `bannerColor` as a single `--property-accent` CSS var on the dashboard content wrapper
  (client-side, reacts live to the property switcher). A single global rule in
  `globals.css` (`.property-accent-scope [data-slot="card"] { border-left: 2px solid
  var(--property-accent) }`) gives every content Card a thin colored left edge, so the
  brand is quietly present on every page. Only active when a banner color is set
  (monochromatic otherwise); dialogs/popovers portal outside the scope and never inherit
  it. Whole thing reverts by deleting the CSS block + the wrapper. NOTE: currently hits
  *every* card in the content area (incl. nested/stat cards) — if that reads as too busy,
  narrow the selector to top-level section cards or drop opacity.

- **Animation timing.** Standardized the shared `Card` hover-lift from `duration-300` to
  `duration-200` to match the sidebar/inventory hover family (`ui/card.tsx`). Overlays
  (dialog/popover/dropdown/select/alert-dialog) were already uniform at `duration-100`;
  the housekeeping floating-bar `duration-300` is an entrance (slow tier), left as-is.

  Verified: all changed files compile on a fresh dev server with zero errors; `eslint`
  adds zero new violations (the one `dialog.tsx:21` error pre-exists this change). Live
  browser screenshot verification was not possible — the Browser pane renderer was
  frozen this session (screenshots timed out, inline style mutations didn't take effect),
  an environment issue, not a code one.

---

## 2026-07-31

- **Warm cast across all neutrals.** The app's neutral ramp moved from cool slate to a
  warm off-neutral (hue ~40°, very low saturation) in both modes: light background
  `#F8FAFC`→`#FAF9F6`, card `#ffffff`→`#FFFEFB`, ink `#0F172A`→`#1C1917`, border
  `#E2E8F0`→`#E6E2DA`; dark background `#0A0A0A`→`#0F0E0C`, card `#171717`→`#1A1917`,
  text `#F5F5F5`→`#F5F2EB` (cream, not white), border `#404040`→`#4A463D`. Paper rather
  than glass — deliberately subtle, meant to read as temperature, not as a beige theme.
  All in `theme.css`. Rationale and the "no cool greys" rule now in DESIGN_PLAN §0.

  **Contrast was measured pair-by-pair against the old cool values before landing, and
  nothing regressed.** Body text stays 16.6:1 (light) / 17.3:1 (dark); muted text
  *improved* 4.55→5.55:1; all four border pairs improved slightly.

- **Status colors deepened — fixes a real AA failure.** `--success`/`--warning`/
  `--destructive` were bright Tailwind defaults that **failed AA as text on a card**
  (3.30:1, 2.94:1, 3.76:1 respectively). Replaced with warm, deeper equivalents:
  success `#3F7A52`, warning `#8F6618`, destructive `#B4402C`, info `#1F5C99` — 5.06,
  5.10, 5.61 and 6.83:1 on card. Each was checked against three surfaces, not one: on
  `--card`, on `--background`, and on its own `-muted` tint, because
  `status-tone.ts toneMutedClasses()` renders status text in the status color on that
  tint. Dark-mode set brightened to match. `--warning-foreground` moved to `#ffffff`.

- **Property accent presets rewritten for the Maldives** (`lib/themePresets.ts`). The
  nine generic shadcn colors (indigo/zinc/red/rose/orange/green/blue/yellow/violet) are
  replaced by six named for the landscape: Ocean `#1A5CA0` (new default, replaces
  indigo), Lagoon `#107880`, Palm `#2F6B45`, Beach `#87703F`, Sunset `#B55018`, Coral
  `#C43E63`. Every one clears 4.5:1 with white label text, stays ≤80% saturation, and
  stays visible as a banner line on both light and dark backgrounds — re-check all three
  before adding a preset. No data migration needed: `bannerColor` is null on every
  seeded property, and it stores a raw hex, so nothing referenced the old preset names.

- **`--chart-5` was a duplicate of `--chart-1`** (both `#F97316`), so two series of any
  five-series chart were indistinguishable. All five chart slots now draw from the
  Maldives palette: Ocean / Lagoon / Sunset / Palm / Coral.

- **`font-mono` was dead.** `globals.css` mapped `--font-mono` to `--font-geist-mono`,
  which is defined nowhere in the repo — every `font-mono` call site (spa page, property
  page, others) was silently resolving to an undefined variable. Fixed by pointing it at
  the sans stack. Also made the sans stack explicit: `--font-sans: var(--font-inter),
  "Helvetica Neue", Helvetica, Arial, sans-serif` — Helvetica ahead of the generic
  fallback as the grotesque Inter descends from. Still one webfont; numeric alignment
  continues to come from `tabular-nums`, not a mono face.

- **Last five direct `lucide-react` imports migrated to the icons adapter**
  (`spa/page.tsx`, `spa-treatments-manager`, `spa-therapists-manager`,
  `spa-rooms-manager`, `spa-categories-manager`) — all Spa files added after the original
  mx-icons migration. Added `CalendarOff` → `CalendarRemoveOutline` to
  `components/icons.tsx`; the other 14 icons already existed. `src/` now has zero direct
  lucide imports outside the adapter itself.

- **"5.6 Design System Master.md" deleted; DESIGN_PLAN.md is the single source.** An
  untracked draft design system had appeared in `.agents/docs/`. Reviewed, and the parts
  worth keeping were folded into DESIGN_PLAN §0 (visual language, house rules) and §2
  (tokens). Four of its proposals reversed already-logged decisions and were **not**
  adopted — 6px/8px radii and pill chips (vs the standing `--radius: 0px` no-curves
  request), JetBrains Mono as a second face, a single fixed product accent (vs the
  per-property one), and bottom-right toasts (they're top-right). Those are recorded in
  DESIGN_PLAN §0.4 so they don't get re-proposed. Also corrected while reconciling:
  §2.7's `--z-banner` documented as `45` when the code says `15`, and §3.3's claim that
  the accent has exactly one consumer (the card-header edge and sidebar wash were added
  later and are now listed).

- **UI/UX audit pass (ui-ux-pro-max skill, DESIGN_PLAN.md authoritative).** The skill is
  now installed at `.claude/skills/ui-ux-pro-max/` (its generated style/palette/font
  suggestions are reference-only — where they conflict with DESIGN_PLAN.md, the plan
  wins; its priority checklist is what was applied). Fixes landed:
  - **61 `aria-label`s added to icon-only buttons** across 37 files (back/edit/delete/
    refresh/more-actions/pagination buttons had no accessible name — the app's biggest
    WCAG gap). Buttons with an sr-only span (dialog/sheet/sidebar close, toggle) were
    already fine and left alone.
  - **`cursor-pointer` added to the shared Button base** (`ui/button.tsx`) — Tailwind v4
    preflight leaves buttons at `cursor: default`.
  - **Login: password show/hide toggle** (Eye/EyeOff, with aria-label) **+
    `autoComplete="email"` / `"current-password"`** on the fields (`auth/login-form.tsx`).
  Verified fine already, no action: focus rings (ring-3 tokens), toast timing (4s/6s +
  top-right), `aria-sort` via the shared table-sort hook, skeleton/empty-state coverage
  (59/63 files), reduced-motion global collapse, sidebar active state, `min-h-screen`
  only (no bare `h-screen`). Deliberate deviations from the skill's defaults: 32px
  button height (desktop-first density, DESIGN_PLAN), 14px body text (same), print
  stationery keeps cool slate (separate print surface). Flagged, not fixed: dead
  "Forgot password?" link (`href="#"`, no reset flow exists); no skip-to-content link.
