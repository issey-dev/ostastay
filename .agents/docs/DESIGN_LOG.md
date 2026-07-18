# Design / UI-UX Log

> Scope: **UI/UX and visual-design changes only** — spacing, color, typography, layout,
> component styling, responsiveness, theming. Not the multi-tenancy/RBAC retrofit (see
> [MASTER_PLAN.md](MASTER_PLAN.md) / [TODO.md](TODO.md) for that). Full rationale and the
> original audit/plan still live in `DESIGN_PLAN.md` at the repo root — this file is the
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
