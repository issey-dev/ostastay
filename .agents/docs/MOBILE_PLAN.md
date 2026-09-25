# Mobile polish — audit & phased plan (Phase 0)

> Status: **Approved 2026-09-25. All phases (1–5) DONE 2026-09-25** — see §7 for what shipped and what is left.
> Desktop stays the primary product and the source of truth: every change here lives
> behind a breakpoint (`max-sm:` / `max-md:` / `md:hidden`), a `pointer-coarse:` variant,
> or a mobile variant of a shared component. Desktop markup and behaviour must not change.

Method: every route captured at 390px (iPhone UA, demo data) with overflow and tap-target
metrics, plus a code review of all 126 dialogs/sheets in 67 files, 74 table files and the
shared `src/components/ui/*` layer. A mobile pass already happened (PR #23, TODO.md
"Responsive design pass"): ~36 screens hand-roll a `md:hidden` card list, and tape chart,
availability, spa and excursion schedules have mobile agenda views. This plan finishes and
consolidates that work rather than starting over. PR #63 (dashboard customise dialog,
folio overlap, payment prefill) is open and not re-audited here.

---

## 1. Root causes (they explain most per-screen issues)

| # | Finding | Where | Effect |
|---|---|---|---|
| R1 | Base `DialogContent` is a centred box with **no max-height or scroll structure**; header/footer not sticky. **93 of 126** dialogs add nothing themselves; 24 put `overflow-y-auto` on the whole box so footer + close button scroll away; only 3 have anything sticky. | `ui/dialog.tsx:66` | Long dialogs run off-screen; with the keyboard open the Save/Submit button is unreachable. |
| R2 | **Tap targets 24–32px** app-wide: Button default 32, `sm` 28, `icon` 32, `icon-sm` 28; Input `h-8`; Select items ~28; tabs ~30; calendar days 32. | `ui/button.tsx`, `input.tsx`, `select.tsx`, `tabs.tsx`, `calendar.tsx` | 5–278 sub-40px targets per page. |
| R3 | `<main className="… overflow-x-hidden">` in the 3 shells **hides overflow bugs** (content silently clipped, unreachable) and makes `<main>` a non-scrolling scroll container, so `sticky` children (app header, profile Save bar) **probably don't stick**. | `dashboard/layout.tsx:110`, `hub/layout.tsx:71`, `osta/layout.tsx:41` | Clipped buttons on Housekeeping, Maintenance, Cashiering, Group detail; Stationery form 812px wide. |
| R4 | Page headers are `flex justify-between` with non-wrapping action rows. | housekeeping:356, maintenance:75, cashiering:396, groups/[id], reservations/[id] (7 buttons) | Actions clipped or 4 rows of buttons before content. |
| R5 | **Wrong keyboards / no autofill:** 93 `type="number"` inputs, **0** with `inputMode`; **0** `type="tel"`; 8 `autoComplete` in the whole app. | forms everywhere | Full QWERTY for money; no phone keypad; no autofill (worst on guest eRegistration). |
| R6 | **iOS zoom on focus:** SearchableSelect's search input is `text-sm` (61 callers); Input/Textarea switch to 14px at `md`, so **iPad** zooms too. | `searchable-select.tsx:164`, `input.tsx` | Page zooms in on every picker open. |
| R7 | `DateRangePicker` renders **2 months (~480px)** — overflows a phone, incl. inside dialogs. | `date-range-picker.tsx:68` | Stop-sale, walk-in, reports. |
| R8 | Right-side sheets are `w-3/4` on phones; trace panel is a fixed **`w-[400px]`** (wider than the screen). | `ui/sheet.tsx`, `trace-panel.tsx:112` | Cramped / clipped panels. |
| R9 | Toasts `fixed top-4 right-4` cover the header and dialog titles on phones. | `ui/toaster.tsx:60` | Close/menu buttons hidden by toasts. |
| R10 | Mobile sidebar sheet likely **stays open after tapping a link** (nothing calls `setOpenMobile(false)` on navigation). *To verify in a browser.* | `ui/sidebar.tsx`, `app-sidebar-nav.tsx`, `hub-sidebar-nav.tsx` | Every navigation needs an extra close tap. |
| R11 | No safe-area handling (`env(safe-area-*)` used nowhere), 49 `vh`/`h-screen` vs 3 `dvh`; viewport export has only `themeColor`. | `app/layout.tsx:50`, `globals.css` | Bottom bars under the home indicator; iOS toolbar clipping. |
| R12 | ~36 hand-rolled table→card lists (40–70 duplicated lines each); still missing on Activity Log, Group detail, Green Tax, Payment Methods, walk-in bill, Daily Details, folio ledger. | many | Inconsistent cards; horizontal-scroll tables hide the important columns. |

**Bugs found that also affect desktop** (logged in TODO.md, fixed in Phase 1):
- Tape chart and availability grid start at the device date (`startOfDay(new Date())`), not the
  property **business date** — the demo shows "No reservations in this window".
  (`tape-chart-grid.tsx:47`, `availability-grid.tsx:53/226`)
- Activity Log module filter displays the raw value `__all__` (plain `Select` without a label
  formatter). (`activity-log/page.tsx:99`)
- Permission-matrix page auto-calls `window.print()` ~800ms after load (hostile on a phone).
- `DateRangePicker` hard-codes `id="date"` (duplicate ids when two are on a page).

---

## 2. Audit table (per screen)

Severity = how broken it is on a phone. Usage = how likely someone opens it on a phone.

### 2.1 App shell & public

| Route / component | Current mobile issues | Sev | Usage | Approach |
|---|---|---|---|---|
| Dashboard shell (`dashboard/layout.tsx`, `ui/dashboard-header.tsx`) | Business date hidden `< sm`; theme toggle takes header space; account + property switch only via menu → sheet → dialog (3 taps); no bottom nav; R3, R9, R10. | High | High | Header: property name + business date; tap → property switch; avatar → account. Bottom nav (see Q1). |
| Hub shell + "Configuring" band (`hub/layout.tsx`, `hub-property-band.tsx`) | ~290px of breadcrumbs + band + H1 + subtitle before content; band repeats the property name in a full-width select. | Med | Low | Band collapses to one row (dot · name · chevron → switcher); hide page subtitle `< sm`. |
| Osta console shell | Same as dashboard; crowded header labels. | Low | Low | Shares shell fixes; hide mono label `< sm`. |
| **`/eregistration/[token]`** (guest-facing, on the guest's own phone) | ID scan/autofill comes **after** 12 typed fields; no `autoComplete`/`type=tel`/`inputMode`; DOB via calendar popover; cramped children row; no progress, submit only at the very bottom; 32px inputs; `min-h-screen`. | **High** | **Very high** | Scan passport first → autofill; autofill attributes; native date or 3 selects for DOB (Q4); steps/accordion "2 of 4" + sticky Next/Submit; 44px controls. |
| `/login`, `/e/[slug]/login` | Structure OK (`autoComplete` present, `h-11` submit); `min-h-screen` jumps with keyboard; show/hide password target size. | Low | High | `min-h-dvh`, 44px targets. |
| `/info` marketing | Top nav `display:none < 1040px` with **no replacement** — product pages only reachable from the footer. | Med | Med | Compact disclosure menu / product pill row. |
| `/docs` | Already responsive. | – | Low | – |

### 2.2 Front office & reservations

| Route / component | Current mobile issues | Sev | Usage | Approach |
|---|---|---|---|---|
| Overview dashboard (`operations-dashboard.tsx`) | Small KPI tiles one per row; ~26 widgets = very long scroll; range chips ~24px; layout shared with desktop customisation. | Med | High | KPIs 2-up; "Today" essentials first; charts under "More insights"; hide reorder controls on touch. |
| Front Office (`front-office/page.tsx`) | Good base (mobile cards). ~460px of KPIs + 2×2 tabs before the first guest; 4 action buttons per card wrap to 2 rows; 36px buttons. | Med | **High** | KPI strip doubles as the tab switcher; sticky search; one primary action per card + ⋯. |
| Reservations list | **Search hidden inside the Filters sheet**; cards ~150px (empty flag row, row holding only ⋯); card-in-card padding. | **High** | **High** | Inline search; tighter card (status + ⋯ in header, one primary action). |
| Reservation detail | 7 outline buttons wrap to ~4 rows before content; **balance near the bottom (~1,300px down)**; Daily Details dialog is a 10-col table. | **High** | **High** | Header: name, status, conf#, 1 primary + More; summary strip with **balance** (tap → folio); collapse secondary sections; tap-to-call guest. |
| New / Edit reservation (`booking-form.tsx`) | ~2,100–2,300px; total + Book/Save at the very bottom; look-to-book grid shows ~1.5 room types; pax 2-col leaves Infants alone; override-rate placeholder cut; errors on untouched form. | Med | Low–Med | Sticky bottom bar (total + Book/Save); room types as cards on mobile; pax 3-col/steppers; secondary sections collapsed. |
| Folio panel | (PR #63 fixes overlap + prefill.) Ledger table 8+ columns. | Med | High | Ledger as row list (date · description · total). |
| Check-in wizard | Footer (Next/Check In) scrolls away; payment row `grid-cols-3` (~100px fields); money keyboard. | **High** | High | Full-screen sheet, sticky footer, stacked payment fields, "Step 2 of 4". |
| Tape chart | Mobile agenda exists but looks empty (business-date bug); no Today/jump; 28px arrows. | Med | Low | Keep agenda; Today + date picker; hide drag/walk-in; hint for moving bookings. |
| Availability | Mobile list exists (same date bug); 65px rows for one number; **Stop Sale is a red primary button** one tap away. | Med | Med | Tighter rows, obvious expand; Stop Sale into a menu + confirm. |
| Groups list | Fine; title wraps beside button. | Low | Low | Stack header. |
| Group detail | **"Pickup Room" clipped**; 4 stat cards stacked; pickups/room-block tables scroll sideways (status/actions off-screen); dialogs `grid-cols-2`. | Med | Low | Wrap + More menu; 2×2 stat strip; pickups as cards; setup desktop-only (hint). |
| Profiles list | Tabs scroll with no cue; **red Delete icon next to Edit on every card**; phone/email not tappable. | Med | Med–High | Segmented/select tabs; Delete into ⋯; tap-to-call/mail. |
| Profile detail | ~2,900px; contact not tappable; low-value sections expanded; no current/next stay on Overview. | Med | Med–High | Contact card with call/email/WhatsApp at top; current/next stay card; 2-col fields; collapse the rest. |
| Profile edit (`ProfileForm.tsx`) | ~3,600px, 58 small targets; comms add row squeezes the value to ~130px; no tel/email types; Save bar may not stick (R3). | Med | Low–Med | Stacked add row with typed input; collapsible sections; sticky bottom Save. |
| Dialogs: trace panel `w-[400px]` (R8); room move (2-col, no max-h); guest picker (create-new expands off-screen); walk-in from tape chart (3-col, 2-month range); stop-sale; eRegistration panel (copy only — **no Share/WhatsApp/QR**). | | Med–High | Mixed | Mostly fixed by R1/R8; eReg gets Web Share + QR. |

### 2.3 Operations & finance

| Route / component | Current mobile issues | Sev | Usage | Approach |
|---|---|---|---|---|
| **Housekeeping** | **Refresh clipped**; room cards ~170px (60 rooms = endless); tapping a card only selects it — status change needs select + find button in a sideways-scrolling floating bar (6 actions, some off-screen); task ✓ icons ~20px. | **High** | **High** | Compact room rows; tap → bottom sheet with big Clean / Inspected / Dirty / OOO / Report issue / Complete task; explicit "Select" mode; fixed bottom bulk bar (2–3 actions + More). |
| Task sheet | Already a phone layout; ✓ buttons `h-7`. | Low | **High** | 44px buttons; surface it prominently for attendants. |
| **Maintenance** | **"Show Resolved" clipped**; 3 stacked columns each `min-h-[500px]` (empty column = a screen of blank); fixed-width status/assignee selects; can't create a ticket here. | **High** | **High** | Segmented tabs (Open / In progress / Resolved) + one list; full-width status/assignee (or ticket sheet); "Report issue" bottom action. |
| **Cashiering** | **"Close Shift (Blind Drop)" clipped**; 4 empty-state cards ~350px each push history down; exchange dialog 2-col grids, no max-h; money keyboard. | **High** | Med | Stack Active Shift; summary strip (expected cash · payments · paid-outs); compact empty states; `inputMode=decimal`; print icons desktop-only. |
| POS / Fast Post | Mostly adapted. Floating "Recent Postings" button covers fields; Post button scrolls away; Guest/Walk-in toggle ~26px; placeholder cut; disabled form unexplained. | Med | **High** (outlet staff) | Sticky bar "Post $X to Room 101" + recent icon; 40px toggles; short placeholder; explain disabled state. |
| Walk-in bill panel | Actions `size=sm` beside balance; Take Payment at scroll bottom. | Med | Med | Sheet + sticky footer (Take payment / Close bill); Void/Reopen under More; print desktop-only. |
| Debtors / debtor detail / new | Card lists exist; doubled page padding; aging = 5 cards (~450px). | Low | Low–Med | Remove extra padding; aging as one compact card; statement print desktop-only. |
| Night audit (+ reports) | Works; dense departure rows; `sm` buttons. Reports mostly have cards. | Low | Low | Stack rows; note "End of Day is best run on a desktop". |
| Reports | Preview is `min-w-[720px]` sideways scroll. | Low | Low | Keep picker + download; hide preview `< md` with hint. |
| Revenue (rate plans, allocations, seasons) | Tabs 2×2 OK, cards exist; rate plan dialog 860px 2-col, allocation price rows cramped. | Low | Low (Manager Flash: Med) | Open on Manager Flash on phones; lists read-only; create/edit desktop-only (hint). |
| Price calendar | **Bulk Update form (~500px) sits above the calendar**; prices cut ("$250.0"), "BASE FALLBACK" overflows cells. | Med | Low–Med | Calendar first as a day list (date · price · source dot) like spa agenda; bulk update desktop-only or a sheet. |
| Spa / Excursions | Agenda views exist; Day/Week/Month toggle shown but inert on mobile; 26px toggles; cut placeholder; therapist select `w-[180px]`; book button scrolls away; pax as number inputs. | Med | Med–High | Open on today's schedule; hide inert toggle; sticky Book; ± steppers for pax. |
| Spa appointment sheet | Lifecycle actions all `size=sm` at the end of a scroll; right sheet `w-3/4`. | Med | **High** | Full-width sheet; sticky footer with the **one next step** (Check in → Start → Complete) as primary; No-show/Cancel/Open bill under More. |
| Activity Log | 5-col table: **Action and Description off-screen**; fixed-width filters; `__all__` bug. | Med | Low | Card per entry (description first); filters in a sheet. |
| Print pages (folio, receipts, reg card, letter, statement, report print) | Fixed-width documents. | Low | Low | Keep as-is; phone banner "Print from a desktop" + Email button (email dialog exists). |

### 2.4 Hub (setup) & Osta console

| Route | Current mobile issues | Sev | Usage | Approach |
|---|---|---|---|---|
| Hub Overview | Works well. | Low | Med–High | Keep; full-width fix buttons. |
| Controls index | 14 tall cards, 2,195px. | Low | Low | Compact rows (icon · title · chevron) `< sm`. |
| Sessions, Support Access | Good; small End/Approve targets. | Low | **High** (lost device; approve support fast) | Keep; 44px actions; pending requests pinned. |
| Booking API Keys | Cards OK; long intro; webhooks dialog no max-h. | Low | Med (revoke leaked key) | List + Revoke on mobile; create/rotate/webhooks hint. |
| People | 3,345px; Edit/Delete full-width on every card; role editor 7xl matrix. | Med | Med (disable leaver, reset password) | Row → edit sheet; Delete in ⋯; role editor desktop-only (hint). |
| Properties | Edit/Delete equal weight. | Low | Low | Delete into ⋯. |
| Night Audit (Hub) | Long explanatory text squeezes switches. | Med | Med (check/change business date) | Business-date card first; explanations behind info hints. |
| **Stationery** | **Layout broken: form clipped to 812px** (grid lacks `grid-cols-1`/`min-w-0`; `sticky top-6` preview under header). | **High** | Very low | Fix the layout (bug), then desktop-only hint. |
| Charge Codes | **10,076px**, 166 small targets. | Med | Very low | Desktop-only hint (read-only list optional). |
| Finance, Inventory, Revenue, Outlets, Spa, Excursions, Online Booking settings, Reservations, Sequences, Guest Lists, Email & SFTP, Channel mapping, Exchange Log, Permission matrix | Long forms/tables; tabs cut ("Floors", "ID / Document Typ…"); Payment Methods table cuts Type column; many dialogs no max-h (R1). | Low–Med | Very low–Low | **Desktop-only hint** (content still reachable, not optimised). R1/R2 fixes apply anyway. |
| Channel status, Inbound Bookings, Green Tax filing | Tables without cards. | Med | Low–Med | Status page keep; inbound bookings as cards; "mark month filed" mobile-friendly, corrections desktop-only. |
| Osta console | Admin tables/forms. | Low | Low (support access, db health: Med) | Support access + db-health status stack; property approval queue usable; rest desktop-only hint. |

---

## 3. Mobile content split (per screen)

| Screen | Show on mobile (essential) | Secondary (collapsed / More) | Desktop-only (hint?) |
|---|---|---|---|
| Overview | Status ribbon, KPIs 2-up, arrivals to check in, departures to settle, alerts, in-house | Trend, pace, mix, receivables, outlets, activity ("More insights") | Customise/reorder (small hint) |
| Front Office | Counts, search, guest list, one primary action, balance on departures | Reg card, eReg, traces, no-show, move (⋯) | — |
| Reservations list | Search, status chips, compact cards, primary action | Date mode/range, ⋯ actions | Auto-assign, tape chart link (already hidden) |
| Reservation detail | Status, dates, room, pax, **balance**, primary action, guest (tap to call), special requests | Move, advance bill, letter, reg card, edit, eReg, transport, deposits, traces, daily summary | Reverse check-in/out (keep in More + confirm), day-by-day table |
| New / Edit reservation | Dates, pax, room type & rate, guest, meal plan, total + Book/Save | Source/TA, group block, override rate, fee policies, accompanying guests, add-ons, requests, remarks | Split-stay segments (hint) |
| Folio | Balance, charges list, post payment/charge | Routing, invoices, move charges, void | Print (hint) |
| Check-in | Guest, room, ID (skippable), payment, Check in | Doc details | — |
| Tape chart | Read-only agenda | Date navigation | Grid, drag-move, walk-in from cell (**hint**) |
| Availability | Day list + per-type expand | Stop Sale (menu + confirm) | Grid editing |
| Groups / group detail | Dates, held/picked/remaining, pickups list | Room block table, eReg | Edit block, pickup room, master folio, timeline (**hint**) |
| Profiles / detail / edit | Search, name, contact actions, current/next stay, preferences, notes; edit name/contacts | ID, address, CRM, settings, finance, attachments | Negotiated rates, AR/credit limit, attachments editing |
| Housekeeping | Status filter, room list, status actions, task complete, report issue | Assign attendant/floor, attendant filter, pax detail | — |
| Maintenance | Open/in-progress tickets, status, assignee, report issue | Resolved list | — |
| Cashiering | Shift status, expected cash, set float, close shift, paid-out, exchange | Shift payments/charges, history | Reconciliation/receipt print (hint) |
| POS | Outlet, guest search, charge code, amount, Post | Description, check no., recent postings, history | — |
| Spa / Excursions | Today's agenda, appointment/manifest actions, simple booking | Companions, notes, history | — |
| Debtors | Balance, open invoices, record payment | Aging | Statement print (hint) |
| Night audit / reports | Business date, status, run End of Day; report pick + download | Step detail | Roll forward, live report preview, trial balance (**hint**) |
| Revenue / price calendar | Manager Flash, rate plan list, price day list | Allocations, seasons (read) | Rate plan / allocation editing, bulk pricing (**hint**) |
| Activity log | Description, who, when | Filters (sheet) | — |
| Hub quick actions | Overview, sessions, support access, key revoke, business date, channel status, inbound bookings, people (deactivate/reset) | — | — |
| Hub setup pages | Readable | — | Charge codes, stationery, finance, inventory, revenue, outlets, spa, excursions, online booking settings, mapping, logs, permission matrix, role editor, email (**hint**) |
| eRegistration (guest) | **Everything** — mobile-first is justified here | — | — |

---

## 4. Shared components to build / adapt first

All additive; desktop classes stay byte-for-byte (verified per component).

1. **Responsive `DialogContent`** (in place in `ui/dialog.tsx`) — fixes ~95 dialogs for free.
   `mobile="sheet" | "fullscreen" | "center"` (default `sheet`); new optional `DialogBody`
   (scrolling region); `DialogHeader` and `DialogFooter` sticky on `max-sm`, footer with
   safe-area padding and full-width 44px buttons. Only `max-sm:` classes are added, so every
   caller's desktop sizing (`sm:max-w-*`, `max-w-7xl`, `max-h-[90vh]`) is unchanged. Same
   treatment for `AlertDialogFooter` (replace its inline style) and `Sheet` (full width `< sm`,
   `dvh` height, sticky header/footer). CSS-only: no Root swap, so no remounts or lost form state.
2. **Touch sizing** via Tailwind v4 `pointer-coarse:` on `buttonVariants`, `Input`,
   `SelectTrigger/Item`, `TabsTrigger`, calendar day cells → ≥44px on touch screens, unchanged
   for mouse users. Global coarse-pointer 16px input rule (kills iOS zoom incl. iPad).
3. **`ui/drawer.tsx`** over `@base-ui/react/drawer` (already installed; no new dependency) —
   swipe-down bottom sheet with virtual-keyboard handling. Used by:
   - **SearchableSelect mobile mode** (61 callers, API unchanged): full-height drawer, 16px
     search, 44px rows.
   - **DatePicker / DateRangePicker mobile mode**: one month, big cells, sticky Clear/Done.
4. **`PageHeader`** (title, hint, actions): actions wrap / collapse into ⋯ below `sm`. Fixes
   every clipped-header bug in one place.
5. **`ActionBar` / `MobileActionBar`**: 1 primary + up to 2 secondary + "More" menu; on phones
   a fixed bottom bar with safe-area padding and a spacer. For reservation detail, check-in,
   POS, spa appointment, housekeeping bulk, booking form Save.
6. **`ResponsiveList`** (`columns` with `mobile: title|subtitle|badge|meta|hidden`, `onRowClick`,
   `rowActions`, `renderCard` escape hatch; table ≥ md unchanged). Consolidates the 36 hand-rolled
   lists over time (reviewed migration, not a sweep) and covers the ones still missing.
7. **`FilterBar`**: inline search always visible + "Filters (n)" → bottom drawer (generalises
   the reservations filter sheet).
8. **`DesktopOnlyNotice`** (`<DesktopOnly feature="…" fallback={…}>`): `md:hidden` friendly
   card, content hidden below `md` (or shown read-only via `fallback`).
9. **`ContactLink`** (tel / mailto / WhatsApp) and **`MoneyInput`** (`inputMode="decimal"`, $
   adornment) + input presets (`money`, `integer`, `phone`, `email`, `search`).
10. **Shell**: mobile header (property + business date, switcher, avatar), toasts bottom-centre
    `< sm`, sidebar closes on navigation, optional **bottom nav** (Q1), `overflow-x-hidden → clip`,
    `min-h-screen → min-h-dvh`, viewport `interactiveWidget: "resizes-content"` (+ `viewportFit:
    "cover"` with safe-area paddings), `ScrollableTabsList` variant.

---

## 5. Phased rollout (ordered by impact)

Each phase: state scope → implement → check at **360 / 390 / 430px + 768px tablet**, with
forms tested keyboard-open → verify **desktop unchanged** (screenshot diff at 1280/1440 of the
touched screens) → short summary (changed / moved or hidden on mobile / known issues / next).
Verification uses the audit capture script (kept as a dev tool) plus manual checks.

**Phase 1 — Foundations (shared layer + shell).** Items 1, 2, 4, 10 above; R3/R6/R7/R8/R9/R10/R11
fixes; the desktop-affecting bugs (business-date start, `__all__`, auto-print, duplicate id);
Stationery layout fix; clipped headers (Housekeeping, Maintenance, Cashiering, Group detail).
*Impact: every dialog and form in the app gets usable on a phone at once.*

**Phase 2 — High-usage operational screens.** Front Office, Reservations list (inline search,
tight cards), Reservation detail (summary strip + More), Folio ledger list, Check-in wizard,
Housekeeping (room action sheet, bulk bar), Task sheet, Maintenance (tabs + report issue),
Spa appointment sheet & today's schedule, POS sticky post bar. Items 3 (drawer pickers), 5, 9.

**Phase 3 — Guest-facing eRegistration.** Scan-first, autofill attributes, DOB entry, steps +
sticky submit, eReg Share/QR from the desk. (Can swap with Phase 2 — see Q5.)

**Phase 4 — Second-tier screens.** Overview dashboard (2-up KPIs, More insights), Profiles
(list/detail/edit + ContactLink), booking form sticky bar + collapsed sections, Cashiering,
Availability, Tape chart agenda, Debtors, Activity Log, Excursions, Price calendar day list,
Hub quick-action pages (sessions, support access, key revoke, business date, inbound bookings,
people). Items 6, 7.

**Phase 5 — Desktop-only hints & the rest.** `DesktopOnlyNotice` across Hub setup pages, Osta
admin, print pages, reports preview, revenue editing, group setup, tape chart editing; compact
Controls index and Hub band; `/info` mobile nav; migrate remaining hand-rolled card lists to
`ResponsiveList` opportunistically.

Rough size: Phase 1 is the largest single change set but mostly in `src/components/ui`; Phases
2–4 are per-screen; Phase 5 is light.

---

## 6. Open questions for the owner

1. **Bottom navigation on phones?** Recommended for the dashboard only (not Hub/Osta): 4
   role-aware slots + More (e.g. Dashboard · Front Desk · Reservations · Housekeeping · More; a
   housekeeper gets Housekeeping · Maintenance first). Or keep the hamburger menu only?
2. **Swipe-to-dismiss** on bottom sheets: CSS-only sheets everywhere (no swipe, zero risk) and
   real swipe drawers only for pickers (SearchableSelect/date) — OK?
3. **Hub on mobile:** agree with "quick actions adapted, everything else readable with a
   'best on a larger screen' hint" (list in 2.4)? Any Hub page you want fully usable on a phone?
4. **eRegistration DOB:** allow the native date input (or 3 selects) on the guest page as an
   exception to the "always use `@/components/ui/date-picker`" rule? Same question for
   staff forms on touch devices.
5. **Order:** eRegistration is the most-used mobile screen (guests). Do it before or after the
   staff operational screens (Phase 2)?
6. **Risky actions on phones:** hide or keep-behind-More-with-confirm for Reverse check-in/out,
   Stop Sale, Delete profile/room/rate? (Plan: keep behind More + confirm.)
7. **Tablet (768–1024):** treat as desktop (current `md` breakpoint) with only the touch-size
   bump — OK?
8. **Housekeeping default for attendants:** open the Task Sheet by default on phones for users
   whose job function is Housekeeping?
9. The dashboard layout (widgets on/off) is shared across devices. Keep one layout, or allow a
   separate phone layout later?

---

## 7. Progress

### Phase 1 — Foundations: DONE (2026-09-25)

- **Dialogs** (`ui/dialog.tsx`): `DialogContent mobile="sheet" | "fullscreen" | "none"`
  (default sheet). Below `sm` a dialog is a bottom sheet (≤92dvh, body scrolls, header and
  footer sticky, safe-area padding); every class is `max-sm:`-prefixed and the scroll wrapper
  is `sm:contents`, so desktop layout is untouched. Check-in wizard uses `fullscreen`; the
  folio panel opts out (`none`, it is already full-screen). `AlertDialog` scrolls and stacks
  its buttons on phones (its inline-style footer became equivalent classes). Right-hand
  `Sheet`s are full width on phones (covers the trace panel's fixed width).
- **Touch sizing:** `pointer-coarse:` ≥44px on Button (all sizes; `link` exempt), Input,
  SelectTrigger/Item, Tabs, calendar days, SearchableSelect rows/search. Unlayered
  coarse-pointer rule keeps form text ≥16px (no iOS zoom, iPad included).
- **Shell:** `<main>` is `overflow-x-clip` + `min-h-dvh` below `md` (3 shells); viewport
  `interactiveWidget: resizes-content`, `viewportFit: cover`, safe-area body padding; phone
  header shows the business date; toasts bottom-centre on phones; the phone menu closes on
  navigation; **bottom nav** (`mobile-bottom-nav.tsx`, dashboard only, 4 role-ordered slots +
  More, `--bottom-nav-offset` lifts other bottom-pinned UI).
- **`PageHeader`** (`ui/page-header.tsx`): actions wrap instead of clipping — Housekeeping,
  Maintenance; Cashiering and Group detail headers wrap too.
- **Pickers:** `DateRangePicker` shows one month on phones and has a unique id.
- **Bugs:** tape chart / availability start at the business date (`useBusinessToday`);
  Activity Log `__all__`; permission matrix no longer auto-prints below `md`; Stationery form
  no longer 800px wide below `lg`.
- **Tooling:** `npm run mobile:audit` (capture routes at given widths with overflow /
  clipped / small-target metrics; pixel diff between two captures).
- Deferred from Phase 1: scrollable `TabsList` variant (one caller), tap-the-header property
  switcher (Phase 2 with the shell's account menu).

### Phase 2 — High-usage screens: DONE (2026-09-25)
- Shared: `ui/drawer.tsx` (base-ui Drawer); SearchableSelect + DatePicker open in it on phones;
  `ui/mobile.tsx` (`MobileActions`, `MobileActionBar`, `DesktopOnly(Notice)`), `ContactLink`,
  `lib/input-presets.ts`; dropdown items 44px on touch.
- Front Office: counts strip, 4 tight tabs, search above the list, one primary action per guest
  card + More. Reservations list: inline search, tight cards (status + ⋯ in the header).
  Reservation detail: one primary + More (reversals last, red, still confirm), summary strip with
  balance, secondary sections collapsed, phone Contact menu (tel/mailto), Daily Details as rows.
  Check-in wizard full-screen, stacked payment, "Step 2 of 4". Folio ledger as a list (+ the
  sub-lg Post-card overlap fixed). eRegistration panel: Share link (Web Share API).
- Housekeeping: compact room rows → action sheet (Clean / Inspected / Dirty / Report issue / OOO /
  complete task), explicit Select mode, pinned bulk bar. Task sheet 44px. Maintenance: Open /
  In progress / Resolved switch. POS: pinned "Post $X to Room N". Walk-in bill: pinned Take
  payment / Close bill. Spa & Excursions: open on today's schedule, pinned Book, next-step footer
  in the appointment sheet, manifest pinned action.

### Phase 3 — Guest eRegistration: DONE (2026-09-25)
- Scan-first step, 4 steps with progress, pinned Next/Submit (safe area), autofill + keyboards on
  every field, native date inputs (DECISIONS 2026-09-25), stacked children, "You're all done"
  state, brand header, `min-h-dvh`. Payload/validation unchanged.

### Phase 4 — Second tier: DONE (2026-09-25)
- Overview: small KPIs 2-up, charts behind "Show more insights", no drag handle on touch.
- Profiles: Directory select, Delete in ⋯, tap-to-call/email; detail contact card + next stay,
  2-column fields, collapsible sections; edit: pinned Save, stacked add-contact row.
- Booking form: pinned total + Book/Save, pax 3-up, room types as cards, secondary sections
  collapsed. Tape chart: Today + date picker, move-bookings notice. Availability: one-line rows,
  Stop Sale in a menu.
- Cashiering summary strip + compact empty states; Debtors compact aging; Activity Log cards +
  filter sheet; End of Day notice; Reports preview → notice; Revenue opens on Manager Flash,
  editing → notices, price calendar first with whole-dollar cells; Group detail stats 2×2, pickup
  cards, setup → notice.
- Hub quick actions: Overview, Sessions, Support Access, API key revoke, People rows + ⋯,
  Properties, Night Audit business date, Inbound Bookings, Green Tax filing.

### Phase 5 — Desktop-only notices & the rest: DONE (2026-09-25)
- "Best on a larger screen" notices: Hub setup pages (Charge Codes, Finance, Inventory, Revenue,
  Outlets, Spa, Excursions, Online Booking, Sequences, Reservations, Stationery, Channel mapping,
  Exchange log, Email & SFTP, Guest Lists), role editor, key create/rotate, Green Tax corrections,
  Osta licensing / controls / channel admin; print pages show a "print from a computer" banner
  and no longer auto-print on phones. Compact Hub Controls index and property band; /info mobile
  menu; login `min-h-dvh` + 44px password toggle.

### Left open / follow-ups
- Consolidating the ~36 hand-rolled card lists into a shared `ResponsiveList` (opportunistic).
- Maintenance has no "Report issue" of its own (issues are raised from Housekeeping).
- Booking form shows "Pick a departure date" before the field is touched (onChange validation —
  desktop behaviour, not changed).
- Spa extended hours still bounded by opening hours (unrelated to mobile; TODO.md).
- Desktop dashboard header was meant to be sticky (see DECISIONS 2026-09-25) — owner's call.
- Pax fields got numeric keypads, not ± steppers.

