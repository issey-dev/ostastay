# Desktop polish — audit & phased plan (Phase 0)

> Status: **Approved 2026-09-25 — owner said yes to every recommendation (answers in DECISIONS.md
> "Desktop polish"), plus a standing rule: clean over convenient — secondary things go behind a
> click.** Progress in §6.
> Companion to [`MOBILE_PLAN.md`](MOBILE_PLAN.md) (done). Goal: the desktop app should feel
> *finished* — uncluttered, one obvious next step, no dead ends, the same patterns everywhere.
> Settled rules stay (DESIGN_PLAN §0.4): square corners, Inter only, toasts top-right,
> one per-property accent, icons from `@/components/icons`. Nothing here changes the phone
> layouts; where a shared component changes, its `max-sm:`/`pointer-coarse:` variants stay.

Method: every audited route captured at 1440px with demo data (`npm run mobile:audit --
capture --widths 1440`, 36 shots incl. 5 dialogs), plus four code audits: navigation / IA,
page patterns, forms-dialogs-feedback, and the seven daily workflows traced click by click
(new booking, arrival, in-house, departure, housekeeping, night audit, manager).

**Headline:** the building blocks are good (tokens are clean — 1 raw palette class left,
Hub is consistent, Night Audit autopilot flows well, folio pre-fills the balance). What makes
the desktop feel unfinished is the **space between** the blocks: every action ends in an "OK"
modal, the next step is somewhere else, the same thing looks different on every page, and
the URL forgets where you were.

---

## 1. Root causes (they explain most per-screen issues)

| # | Finding | Evidence | Effect |
|---|---|---|---|
| D1 | **Blocking success modals.** 129 `setNotification({title,message})` calls open a dialog that must be clicked OK — even for success. Folio panel (30) is itself a dialog, so it stacks modal-on-modal. | `folio-panel.tsx:1084`, `reservations/[id]` (25), `reservations` (20), `housekeeping` (19), `front-office` (11), `tape-chart-grid` (7), `booking-form` (5) | +1 click on almost every action; the #1 "clunky" feeling. |
| D2 | **No "next step" after an action.** Save booking → reservations list (buried, no link). Check-in → OK. Check-out with balance → "Settle it first" + OK only. Walk-in saved → back to Front Desk, find the guest again. | `booking-form.tsx:122,503`, `check-in-wizard.tsx:309`, `front-office/page.tsx:183`, `check-out.ts:127` | Staff re-find what they just touched; flows feel broken into pieces. |
| D3 | **The URL forgets state.** 0 of 17 tabbed screens keep the tab in the URL; no filter is in the URL; Back from a reservation lands on Arrivals, not Departures. Dashboard "Check out" links land on Arrivals. | `front-office:536`, `revenue:112`, `profiles:98`, spa, excursions, pos, folio… `operations-dashboard.tsx:917-927` | Back/refresh/deep links all reset; can't bookmark or share a view. |
| D4 | **Rows aren't links.** Tables navigate with `onClick + router.push`; Ctrl/middle-click, hover URL and "open in new tab" don't work. | `front-office:347,644,743…`, `reservations:832,949`, profiles stay card | Front desk can't keep two reservations open side by side. |
| D5 | **No page shell standard.** `PageHeader` used by 2 pages; ~22 copy an `<h2 text-xl…lg:text-3xl>`; Hub titles are `text-2xl`, dashboard `text-3xl`; h1/h2 mixed; 6 one-off `max-w-*`; double padding on 2 pages. Sidebar label ≠ page title on 7 pages (Tape Chart → "Availability Matrix", Night Audit → "End of Day"…). | see §2 | Each page feels like a different app. |
| D6 | **Header actions sprawl.** Reservation detail: 7 equal outline buttons in 2 rows, "Reverse Check-in" beside "Letter", no primary; folio: 5–6 incl. Delete beside Routing. The phone version already has 1 primary + More. | `reservations/[id]/page.tsx:495-600`, `folio-panel.tsx:580-660` | Clutter; risky actions one mis-click away. |
| D7 | **Card-per-section with empty cards.** Detail pages stack full-width cards whose body is "No X yet" (Transport, Deposits, Traces; profile: Identification, Attachments, Notes, CRM all "—"). Cashiering: 3 empty cards × ~340px. | screenshots `dash-reservation-detail`, `dash-profile-detail`, `dash-cashiering` | Long scroll of nothing; the important numbers (balance) are at the bottom. |
| D8 | **Seven KPI card implementations, five empty-state styles, three loading styles.** No `loading.tsx` / `error.tsx` anywhere (32 client pages fetch in `useEffect` → blank flash). 31 "Loading..." text loaders, 44 hand-rolled empty `<p>`s. | page-patterns audit | Visual inconsistency; pages "pop" in. |
| D9 | **No shared list table.** Sorting only in settings tables; no result counts ("50 of 312"); profiles silently capped at 50 (`api/profiles/route.ts:41`); no sticky header; no CSV export; 5 different filter-bar layouts. | page-patterns audit §4–5 | Lists feel basic next to the rest. |
| D10 | **Dialog sprawl.** 120 dialogs in 23 widths; 29 inherit `sm:max-w-sm`; 98 have no desktop `max-h` (long forms overflow a 768px laptop); 5 × `7xl` dialogs that are really pages/sheets; 14 dialogs without `<form>` so Enter does nothing. | forms audit M1, M5 | Unpredictable dialogs; laptop users lose the Save button. |
| D11 | **Unsafe / lossy interactions.** ~12 deletes/voids with no confirm (profile sub-records, trace, folio, routing rule, licence void, excursion no-show); 2 `window.prompt()` (Reverse check-out, **Void bill**); 0 unsaved-changes guards (booking form, profile edit, 17–27-field dialogs lose input on Esc/click-outside); 12 confirm buttons without `disabled` (double submit). | forms audit H2, H3, M2 | Data loss and accidental destructive actions. |
| D12 | **No way to jump.** No global search / command palette; only shortcut is Ctrl+B; property switch and Hub link are buried in the Account dialog; no dashboard breadcrumbs; every browser tab is titled "Uppsolut Stay" (0 of 69 pages set a title). | nav audit H1, H4, M1, M3 | Finding a guest = sidebar → list → search. Tabs indistinguishable. |
| D13 | **Hub save model mixed.** Same page auto-saves some switches and needs Save for others (General, Night Audit); Finance has 5 separate Save buttons with 3 labels; no dirty/"Saved" indicator except one form. | forms audit M4, `hub-finance` shot | Users unsure whether a setting stuck. |

**Real bugs found (also logged in TODO.md):**
- **Check-in payment silently lost:** the wizard's optional payment POST isn't checked — if it
  fails, "Checked In" still shows. `check-in-wizard.tsx:303-308`.
- **Tape-chart Check In bypasses the wizard** (no ID, reg card or held-nights decision) — two
  check-in paths behave differently. `tape-chart-grid.tsx:67-70`.
- **Fallback redirect 404s:** `dashboard/page.tsx:32` falls back to `/dashboard/profile` (no such route).
- **Orphan page** `/dashboard/inventory` (345 lines, "Housekeeping Operations") — not in nav,
  overlaps Housekeeping/Maintenance.
- **Rounded pill chips** break the square-corners rule: special requests
  (`booking-form.tsx:1086`) and rate-plan allocation chips (`revenue/page.tsx:573`).
- Profile heading renders the title upper-case ("MRS Jennifer Wilson").
- Night audit auto no-shows un-arrived bookings with only a count shown — no names, no pause.

---

## 2. Audit table (per screen)

Severity = how unfinished it feels on desktop. Usage = how often staff see it.

### 2.1 Shell & navigation

| Area | Issues | Sev | Usage | Approach |
|---|---|---|---|---|
| Header (`dashboard-header.tsx`) | Only brand, business date, theme toggle. Property switch + Hub link hidden in Account dialog. Business date not clickable. Property name is the page `<h1>`. | High | Every page | Property name = switcher dropdown; **Ctrl+K search box**; "Operations ⇄ Setup" toggle; business date → Night Audit; brand is not a heading. |
| Sidebar (18 items, 4 groups) | Solid; jargon labels ("Client Relations", "Fast Post"); no `SidebarRail`; footer hand-rolled. | Low | Every page | Rename (Q3); add rail; `SidebarFooter`. |
| Hub sidebar | 14 property sections only reachable via the Controls index — to move General → Finance you go back to Controls. `<a>` → full reloads. | Med | Low–Med | Property sections listed under "Property" in the sidebar (collapsible); `<Link>`. |
| Osta sidebar | No active state; `<a>` full reloads. | Low | Low | Longest-prefix active + `<Link>`. |
| Breadcrumbs | Hub has them; dashboard none; detail pages rely on a history-dependent Back arrow. | Med | High | `DashboardBreadcrumbs` from `NAV_GROUPS` on detail/child pages. |
| Tab titles | All "Uppsolut Stay". | High | Every tab | Segment `layout.tsx` metadata; detail pages show conf# / guest. |

### 2.2 Front office & reservations

| Screen | Issues | Sev | Usage | Approach |
|---|---|---|---|---|
| Overview dashboard | Title repeats property + business date from the header. Demo showed a single widget on a huge empty canvas (verify: layout vs. load timing). Drill-down links ignore tabs. No "New booking". | Med | High | Title "Today" + one-line status; empty-canvas guard ("Add widgets"); links with `?tab=`; New booking / Walk-in in header. |
| Front Desk | Business date shown twice; KPI tiles are a 2nd KPI implementation; tabs not in URL; no refresh-on-focus (two desks go stale); success via modal. | Med | **Very high** | URL tabs; focus/interval refresh; StatTile; toasts; row = link. |
| Reservations list | "Reservations & Stays" + card header "Reservations" (title twice); no count; Auto-Assign as prominent as New Booking; filters not in URL. | Med | **Very high** | PageHeader + `ListTable` with count, sticky header, sort; URL filters; Auto-Assign into ⋯. |
| **Reservation detail** | 7 equal header buttons, no primary; balance bottom-right ~1,000px down; 3 empty full-width cards; Rate Total ($1370) vs folio ($1167.56) side by side with no explanation; Travel agent not a link. | **High** | **Very high** | **Two-column layout**: left = stay, room, guest, requests, activity; right = sticky **summary rail** (status, dates, balance, primary action by state: Check in / Settle & check out / Open folio). Header: 1 primary + More (reversals last, red). Empty sections collapse into an "Add transport / deposit / trace" row. |
| New / edit booking | Good structure + sticky summary. Section 2 empty until dates; "Book Now" enabled-looking on an empty form; after save → list (D2); quick-create guest doesn't carry the search text. | Med | High | Land on the new reservation with toast + "Take deposit / Send confirmation"; seed quick-create; unsaved guard; square chips. |
| Folio panel (95vw dialog) | Modal-on-modal notifications; Delete folio unconfirmed; no check-out from here. | **High** | **Very high** | Toasts; confirm; **"Settle & check out"** footer when balance = 0; consider a full page route `/folios/[id]` (Q5). |
| Check-in wizard | Good. Ends in OK modal; no next step; payment bug. | Med | High | Done screen: Open folio · Print reg cards · Add trace. Fix payment. |
| Tape chart | Page titled "Availability Matrix"; tiny `< >` arrows, no Today / date jump / range; heavy saturated bars; last column clipped; check-in bypasses wizard. | Med | High | Toolbar: Today · date picker · 7/14/30 · legend; softer bar fills (status tint + solid left edge); route check-in through wizard. |
| Availability, Groups | OK. Naming overlap with Tape Chart. | Low | Med | Naming (Q3). |
| Profiles list / detail | List OK (silent 50 cap). Detail: 8 cards, most empty ("—"); settings/finance/marketing cards of "No"/"—". | Med | Med | Summary header (contact, VIP, next stay, visits, balance) + tabs *Overview · Stays · Finance · Documents*; hide empty fields in view mode ("Add ID", "Add note" links). |

### 2.3 Operations & finance

| Screen | Issues | Sev | Usage | Approach |
|---|---|---|---|---|
| Housekeeping | Whole-card status tints (60 rooms = wall of red/green); on desktop a click only selects — single-room change needs select + bulk bar. | Med | High | Neutral cards with a status stripe + label; click → status menu; explicit Select mode for bulk (same as phone); optional compact grid/list toggle. |
| Maintenance | OK after mobile pass. | Low | Med | Shell standards only. |
| **Cashiering** | Noisiest screen (9 cards, 34 borders); 3 empty cards ~340px; shift ID as red badge; Close Shift low-contrast red text. | **High** | Med–High | One shift summary bar (float · expected cash · payments · paid-outs · Close shift); below it one tabbed list (Payments · Exchanges · Paid-outs · History) with compact empty states. |
| Fast Post | Outlet not remembered; search needs a button press; disabled "Post to Folio" is a huge pink bar; recent-postings panel full-height empty. | Med | High | Remember outlet; search-as-you-type; normal-size primary; recent panel shrinks to content. |
| Night audit | Best flow in the app. Departure with balance → no folio link; auto no-shows with no list. | Med | Daily | Folio button in departure rows; "Review arrivals" pause with names. |
| Revenue | Tabs detached from content; New Rate Plan floats on its own row; calendar cells display-only; plan dropdown disabled on calendar. | Med | Med | Tab bar + action on one line; click/drag cells to set a range + inline price popover; switchable plan. |
| Debtors, Reports, Spa, Excursions, Activity log | Shell/table/empty-state drift; Reports split from EOD archive. | Low | Med | Standards; EOD archive as a Reports tab. |

### 2.4 Hub

| Screen | Issues | Sev | Usage | Approach |
|---|---|---|---|---|
| Hub overview | Good ("5 items need attention"). | – | Med | Keep. |
| Controls index | Fine as a landing; the problem is getting *between* sections (2.1). | Low | Med | Sidebar sections. |
| Finance (and other long setup pages) | ~3,000px; 5 Save buttons, 3 labels; long explanatory paragraphs; toggle style reads oddly. | Med | Low | Sub-nav (anchors) on the left of long pages; one save model (D13); help text behind InfoHint; `SaveBar` per section with "Saved ✓". |
| Rate plan / big dialogs | Required-field error shown on open; chips rounded. | Low | Low | Errors after touch; square chips. |

---

## 3. Shared components to build / adapt first

All additive; phone variants from MOBILE_PLAN stay intact.

1. **Feedback: `notify` → toast.** Replace `setNotification` success/ordinary errors with
   `toast` (`lib/toast.ts`); keep a modal only for errors that need a decision, and give those an
   action ("Open folio"). One `apiError(res)` helper replaces 4 local ones; short copy guide
   ("Room moved", "Couldn't move the room. Try again.").
2. **`PageHeader` everywhere** (title = only `<h1>`, `text-2xl`, description, primary action,
   secondary + More menu, optional breadcrumbs slot). `DashboardBreadcrumbs` from `NAV_GROUPS`.
   Segment `layout.tsx` metadata titles. One content width; `narrow` prop for forms.
3. **`ActionBar` (desktop)**: 1 primary + ≤2 secondary + More (destructive last, red, confirm) —
   the desktop sibling of `MobileActions`, same action list feeds both.
4. **`useUrlState` / `useUrlTab`**: tabs and filters in the query string (`router.replace`).
5. **`ListTable`**: sticky header, sortable columns, result count, whole-row `<Link>`, optional
   CSV export, `EmptyState`/`ErrorState`/skeleton built in; pairs with a `FilterBar`
   (search, selects, date range, "Clear (n)", URL-synced). Phone view keeps `MobileCardList`.
6. **`StatTile`** moved to `ui/` as the only KPI card; **`EmptyState size="inline"`**;
   **`InlineLoading`**; `dashboard/loading.tsx`, `hub/loading.tsx`, `error.tsx` boundaries.
7. **`DialogContent size="sm|md|lg|xl"`** (425/560/720/960) with desktop `max-h-[90vh]`,
   scrolling body, fixed footer as the default; 7xl dialogs → `Sheet` or page.
   **`SubmitButton`** (pending spinner + label, disabled). Every dialog with inputs is a `<form>`.
8. **Safety**: `useConfirm` gains a `reason` field (replaces `window.prompt`); applied to every
   delete/void; `useUnsavedGuard(isDirty)` for pages + "discard changes?" on dirty dialog close.
9. **Command palette (Ctrl+K)**: pages from `NAV_GROUPS` (permission-filtered), actions
   (New booking, Walk-in, Post charge), and search over reservations (conf#/guest), profiles and
   rooms — backed by the trigram indexes already on this branch.
10. **`SummaryRail`**: sticky right column for detail pages (reservation, profile, group, debtor).

---

## 4. Phased rollout (ordered by impact)

Each phase: scope → implement → capture 1280/1440 before/after (`mobile:audit capture/diff`) →
check **phones unchanged** at 390 → click through the affected workflow → short summary. Docs
screenshots re-shot where a Configuration/Operations page changes.

**Phase 1 — Flow & feedback (biggest felt change, little visual risk).** D1 toasts in front
office, folio, reservation detail, booking form, tape chart, housekeeping; D2 next steps (land on
new booking, check-in done screen, Settle & check out, "Open folio" on balance errors, walk-in →
wizard, post-checkout invoice offer); D3 URL tabs on Front Desk/Revenue/Profiles/POS/Spa/
Excursions + dashboard deep links; front-desk refresh on focus; the bugs in §1.

**Phase 2 — Shell & navigation.** PageHeader on every page + one title size + names aligned
(Q3); tab titles; dashboard breadcrumbs; header property switcher, Ops ⇄ Setup toggle, business
date link; rows as links (D4); Hub property sections in the sidebar; `<Link>` in Hub/Osta.

**Phase 3 — Declutter the heavy screens.** Reservation detail two-column + summary rail +
ActionBar; folio header ActionBar; Cashiering summary bar + tabbed lists; Profile detail summary
+ tabs + hidden empties; Housekeeping neutral cards + click-to-status; Fast Post tidy; Tape chart
toolbar + softer bars; Overview title/empty-canvas.

**Phase 4 — Consistency layer.** `ListTable` + `FilterBar` (reservations, profiles, debtors,
groups, activity log, then settings managers); StatTile, EmptyState inline, loading/error
boundaries; Dialog sizes + SubmitButton + forms-as-`<form>`; confirms, reason prompt,
unsaved-changes guard; label/copy pass (Save / Add ‹noun› / Create); square chips.

**Phase 5 — Power features.** Command palette (Ctrl+K) + a few shortcuts (N = new booking,
/ = search, ? = shortcut sheet); price-calendar click-to-edit; night-audit arrivals review; Hub
save model (D13) + long-page sub-nav; migrate the remaining non-RHF daily forms (spa, excursions,
POS, folio dialogs) to the form standard.

Rough size: Phase 1 is mostly per-screen wiring (no new visuals); Phase 2 touches every page
lightly; Phase 3 is the most visible; Phase 4 is the widest but mechanical; Phase 5 is additive.

---

## 5. Open questions for the owner

1. **Toasts vs modals:** OK to turn every *success* message into a top-right toast, keeping
   modals only for errors that need a decision (with an action button)?
2. **Reservation detail layout:** two columns with a sticky summary rail on the right (balance +
   the one next action), secondary sections collapsed when empty — OK?
3. **Naming:** one name per destination in sidebar, title, tab and docs. Proposal: Front Desk,
   Reservations, **Room Chart** (tape chart), Availability, Groups, **Guests & Companies**
   (Client Relations), Housekeeping, Maintenance, **Post Charges** (Fast Post), Night Audit
   (not "End of Day"), Reports. Keep the hotel-industry terms instead?
4. **Command palette (Ctrl+K)** with guest/reservation/room search — wanted? (Biggest single
   speed-up for experienced staff.)
5. **Folio**: keep the 95vw dialog, or make it a real page (`/folios/[id]`, linkable, openable
   in a tab) with the dialog kept as a quick view?
6. **Header**: move the property switcher into the header and add an "Operations ⇄ Setup"
   toggle (today both are inside the Account dialog)?
7. **Housekeeping board**: neutral cards with a coloured status stripe instead of fully tinted
   cards?
8. **Hub save model**: save-per-section with a "Saved ✓" state everywhere, auto-save only for
   single toggles — OK?
9. **Order**: Phase 1 (flow) before Phase 2 (shell)? Phase 1 is what staff feel most; Phase 2 is
   what a demo/sales viewer notices first.
10. **Orphan `/dashboard/inventory`**: delete or redirect to Housekeeping?

---

## 6. Progress

### Phase 1 — Flow & feedback: DONE (2026-09-25, branch `feat/desktop-polish`, uncommitted)
- **Shared:** `toast(..., { action })` (one button in a toast — the next step); `useReasonPrompt()`
  in `confirm-provider.tsx` (replaces `window.prompt`); `useUrlState()` (`src/lib/use-url-state.ts`,
  tab/filter in the query string); `ui/action-bar.tsx` `ActionBar` (desktop: 1 primary + 1
  secondary + More, fed the same `MobileAction[]` list as the phone menu).
- **Blocking OK modals → toasts** in Front Desk, folio, reservation list + detail, booking form, tape
  chart, housekeeping, task sheet, revenue. Balance-outstanding check-out now offers **Open folio**.
- **Next steps:** new booking lands on the reservation ("Booking X created"); walk-in lands on Front
  Desk `?checkin=<id>` which opens the check-in wizard; check-in toast has "Open folio"; folio panel
  shows **Check out** when in-house and settled (`FolioPanel onCheckedOut`); room move defaults to
  the current type + toast; guest quick-create seeded from the search text.
- **Folio page:** `/e/{slug}/dashboard/reservations/{id}/folio` (`FolioView` shared with the
  dialog; the dialog has an "open in new tab" link). Folio header: 2 visible + More.
- **URL state:** tabs on Front Desk (`arrivals|departures|inhouse|roommoves`), Revenue, Profiles
  (list + detail), POS, Spa, Excursions; reservations list `q`/`status`/`mode`/`dates`. Dashboard
  links deep-link to Departures / In-house. Front Desk refreshes on window focus.
- **Reservation detail two-column (owner-approved):** from `lg`, main column + sticky
  `ReservationSummaryRail` (status, dates, room, balance, ONE next action: Check in / Settle folio /
  Settle and check out / Check out / Reinstate; Open folio + new-tab link; open traces). Header =
  Move room + More. Empty Transport/Deposits/Traces collapse into one "+ Add …" line. Below `lg`
  unchanged; phones unchanged (verified at 390).
- **Bugs fixed:** check-in payment failure now surfaced; tape-chart check-in goes through the
  wizard; `/dashboard` fallback no longer 404s ("No screens available" state, no redirect loop);
  `/dashboard/inventory` redirects to Housekeeping (`WorkOrderManager` now unused — not deleted);
  square chips (booking form, rate plan); profile title case; Tape Chart page title; Void bill and
  Reverse check-out use the reason prompt; folio/routing-rule/trace deletes confirm.
- **Not verified in a browser by clicking** (captures only): check-out-from-folio, walk-in →
  wizard hand-off, toast actions. Needs a click-through with the demo login.
- Note: the demo admin's saved dashboard layout hides every widget but Occupancy (data, not a bug).

### Phase 2 — Shell & navigation: DONE (2026-09-25)
- **`PageHeader`** is the only page title on every dashboard page (h1, `text-xl sm:text-2xl`), sets
  the browser-tab title (`DocumentTitle`, "Reservations · Uppsolut Stay"), `crumb` renders
  `DashboardBreadcrumbs` ("Reservations › VM4224", derived from `NAV_GROUPS`; desktop only — phones
  keep the back arrow). Page titles = sidebar labels (Front Desk, Reservations, Tape Chart, Group
  Blocks, Housekeeping, Revenue, Cashiering, Night Audit, Daily Reports…). Duplicate card titles and
  business-date lines removed; per-page double padding/max-widths removed.
- **Header:** property name is a switcher dropdown (multi-property users); Ctrl+K search box;
  business date links to Night Audit; "Setup" link to the Hub; the Hub header has "Operations".
  Header brand is no longer an `<h1>`.
- **Rows are links** (primary cell `<Link>`, row click kept): Front Desk, profiles, groups,
  debtors, stay history, group reservations.
- **Hub:** Controls is a collapsible sidebar group listing its sections (`isControlsSection` in
  `hub-nav.ts`, shared with the Controls landing); `<Link>` instead of `<a>`; Overview/People/
  Sessions/Controls on `HubPageHeader` (h1 + tab title). **Osta:** client nav with active state
  (`osta-sidebar-nav.tsx`), PageHeader on list pages.

### Phase 3 — Declutter: DONE (2026-09-25)
- **Cashiering:** one shift summary bar (float · expected · payments · paid-outs) + Close shift /
  New exchange / More; one tabbed card (Payments · Exchanges · Paid-outs · History, `?tab=`).
- **Profile detail:** summary line (contact links, nationality, visits, next stay, debtor link);
  tabs Overview · Stays · Finance · Documents (`stay-history` still accepted); empty fields hidden,
  "Add …" links; sub-record deletes confirm.
- **Housekeeping:** neutral cards with a status stripe + label; click → status menu (Clean,
  Inspected, Dirty, Complete task, Report issue, Out of order); explicit Select mode on every width;
  "Select all" selects only the rooms shown.
- **Tape chart:** toolbar (Today, prev/next, jump date, 7/14/30 `?days=`, legend); softer bars
  (tint + 3px edge); no clipped last column.
- **Fast Post:** search as you type, normal-size Post button, compact recent list, InfoHint.
- **Overview:** empty-page line with "Customise".

### Phase 4 — Consistency layer: shared pieces DONE; adoption see below
- New: `ListTable` + `FilterBar` (ui/), `StatTile` (ui/stat-tile.tsx), `EmptyState size="inline"`,
  `InlineLoading`, `SubmitButton`, `DialogContent size="sm|md|lg|xl"` + desktop scroll-inside by
  default, `useUnsavedGuard`, `apiError`, `loading.tsx`/`error.tsx` for dashboard and Hub
  (`PageSkeleton`, `RouteError`), `Download` icon.
- Lists on ListTable/FilterBar: profiles (API `X-Total-Count` → "50 of 312"), debtors, groups,
  activity log (URL filters, CSV export); reservations list shows a result count.
- Setup managers (controls/settings/inventory/revenue/hub): hand-built delete dialogs →
  `useConfirm`; widths → `size`; SubmitButton; forms submit on Enter; StatusBadge tones
  (Hub `StatusBadge` duplicate renamed `ConnectionBadge`); sentence-case labels (Save / Create /
  Add ‹noun›); `apiError`; **Hub save model** in `controls/save-status.tsx` — `SectionSaveFooter`
  (one Save per section, disabled until dirty, "Unsaved changes"/"✓ Saved") and `SavedTick`
  for auto-saving single controls.
- Operational components: StatTile everywhere (Front Desk, group detail, flash report, EOD
  archive, Osta health/email usage); unsaved-changes guard on booking form and profile form;
  "Discard changes?" on dirty walk-in / group pickup / check-in wizard; dialogs as `<form>`s
  (Enter submits; dialog submit handlers stopPropagation so a nested dialog's Enter doesn't
  submit the form behind it); pending guards; InlineLoading / inline EmptyState; toasts.
- Daily forms on Zod + RHF (Phase 5 item): Fast Post, Excursions, Spa booking
  (`src/lib/sales-form-schemas.ts`, tests `tests/business-rules/sales-forms.test.ts`); payloads
  unchanged. Spa participant slots still plain state (TODO).
- Tooling: `mobile:audit` and `docs:shots` match button text case-insensitively and wait for
  the button (skeleton loaders have no "Loading" text).

### Phase 5 — Power features
- **Ctrl+K / "/" command palette** (`shell/command-palette.tsx`, `GET /api/search`): pages
  (sidebar allow-list), actions (New booking, Walk-in, Post a charge, New profile, Setup) and search
  over reservations, rooms (with in-house guest) and profiles, each gated by module view permission.
- **Night Audit:** Folio button on each due-out row (balance error → "Open folio" toast); autopilot
  pauses before posting while un-arrived bookings would become no-shows and lists them by name
  (`pendingArrivalList` on `/api/eod/status`); title carries Open/Closed, date is the description.
- **Price calendar:** rate plan switchable in the header (navigates `?ratePlanId=`); click a day
  then another to fill the Bulk Update range; Configuration card removed; calmer cards.
- **Hub long pages:** `HubSectionNav` jump links under the header when a page has 3+ ControlsCard
  sections (ControlsCard now has `id`/`data-section`).
