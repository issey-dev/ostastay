# Alpha Version 4 Plan — Front Desk, Reservations & Housekeeping hardening

> Written 2026-07-21 after a three-way codebase audit of the modules the app owner has
> not yet touched (Reservations management, Front Office, Housekeeping/Maintenance).
> Status legend: ⬜ not started · 🚧 in progress · ✅ done
> Companion docs: [MASTER_PLAN.md](MASTER_PLAN.md) (multi-tenancy retrofit, done),
> [TODO.md](TODO.md) (running list), [DECISIONS.md](DECISIONS.md) (business rules).

## Context

Alpha 1–3 hardened multi-tenancy/RBAC, revenue (rate plans, allocations, tax),
Debtors, Outlets, Profiles, activity logging, and the Osta platform-admin console.
The three *operational* modules — the screens front-desk and housekeeping staff
actually live in all day — were never given the same pass. The audit found the same
pattern in all three: a good visual shell over broken or missing core workflows,
pre-standard code (no Zod/RHF, `any` types, `alert()` errors), and several
regressions introduced when the underlying APIs were hardened in Alpha 3 but their
UI callers were never migrated.

---

## Phase 0 — Broken-workflow bug fixes (do first; each is a real defect) ✅

**Completed 2026-07-21** — all items below fixed except #11, which turned out to be a
false positive (the confirmation-letter print page's Email button does call
`send-confirmation`; the audit agent's grep missed it). 271/271 suite passing,
`tsc --noEmit` clean. API-side changes live-verified via authenticated curl against
the dev server (summary vacant fields, tape-chart propertyId, report `format=json`);
a full UI click-through was blocked by the same Browser-pane/localhost sandbox issue
as the platform-admin session — recommended as a follow-up. Notes on the fixes:
#1 Front Office now calls the dedicated check-in/check-out routes and surfaces
`roomWarning`/`creditLimitWarning` via a notification dialog (alert() removed);
#3 the calendar now expands reservations into per-assignment bars (split stays render
correctly); #4 group links point to the edit page until Phase 2's detail page exists,
and Master Folio opens the group's master folio in `WalkInFolioPanel`; #6 the PDF
routes gained a `?format=json` mode the Printable View now consumes; #9 the summary
switched to UTC day boundaries (matching how reservation dates are stored); #10 the
KPI now counts all sellable unoccupied rooms with a "clean & ready" subcount.

These are confirmed bugs, not improvements. Ordered by severity.

1. **Front Office Check-In / Check-Out buttons are dead.**
   `front-office/page.tsx` `updateStatus()` PATCHes `/api/reservations/[id]/status`
   with `IN_HOUSE` / `CHECKED_OUT` — but the Alpha-3 state machine explicitly
   rejects both (400: "Use the Check-In action instead"). Every click on the
   primary front-desk surface fails into a generic `alert()`. Re-point to the
   dedicated `POST .../check-in` and `.../check-out` routes (the Reservations list
   page already does this correctly).
2. **Tape chart ("Availability Matrix") renders permanently empty.**
   `tape-chart-grid.tsx` fetches `/api/reservations/tape-chart` without
   `propertyId`; the route hard-requires it and 400s. Add the param from
   `useProperty()`.
3. **Calendar view shows every reservation as "Unassigned".**
   `reservations/calendar/page.tsx` positions bars by `res.roomId`, a field that
   doesn't exist (`Reservation` has no `roomId`; rooms live on `RoomAssignment`).
   Key on the assignment's room instead.
4. **Group detail page: 404 links + blank columns.**
   Links pickups to `/reservations/[id]` (route doesn't exist — see Phase 2's
   detail page) and reads wrong fields (`reservationNumber` → `confirmationNo`,
   `room.number` → `roomNumber`), so Res# renders blank and Room always says
   "Unassigned". "Master Folio" button has no onClick.
5. **Departure PDF balance math is wrong.** `departure-pdf/route.ts` reads only
   `folios[0]`, sums line items without filtering `isVoid`, and counts refunds as
   payments. Balance Due can be materially misstated. Align with the folio panel's
   math (all folios, exclude voids, subtract refunds).
6. **Reports "Printable View" is dead.** `reports/page.tsx` does
   `endpoint.replace('.pdf', '-json')` on URLs containing `-pdf` (no dot) — a
   no-op — then calls `.json()` on a PDF binary. Also `isArrivalLoading`/
   `isDepartureLoading` are never set. Either build the JSON endpoints or drop the
   button.
7. **`roomWarning` / `creditLimitWarning` still unwired** (known TODO carry-over):
   check-in into a DIRTY room returns `roomWarning`, checkout returns
   `creditLimitWarning`/`commissionsPosted` — both dropped by the Front Office page
   (and `roomWarning` also by the Reservations page). Surface as toasts once item 1
   is fixed.
8. **Auto-created CHECKOUT housekeeping tasks are uncompletable.** The board's
   complete button is wired only to `SPECIAL_REQUEST` tasks; CHECKOUT tasks render
   as a static badge, the GET filters to non-completed, so they accumulate forever.
9. **Timezone inconsistency:** `front-office/summary` computes "today" in server
   local time; arrival/departure PDFs use UTC boundaries. Dashboard and PDF can
   disagree near midnight. Pick one convention (property-local is correct long-term;
   at minimum make them agree).
10. **"Vacant Rooms" KPI undercounts** — counts only `CLEAN` unoccupied rooms;
    DIRTY-but-unoccupied are excluded. Decide the intended semantics (vacant vs.
    vacant-ready, possibly show both).
11. **`send-confirmation` email endpoint is orphaned** — fully built + tested, no
    UI caller. Add an "Email" action beside the Confirmation Letter print action.

## Phase 1 — Front Desk workflow completion ⬜

The Front Office page becomes a place where a receptionist can run a whole shift
without leaving it.

- **Check-in flow (dialog, not just a button):** assign/change room inline
  (vacant+clean rooms of the booked type, warn on DIRTY per `roomWarning`),
  optionally take a deposit/payment in the same dialog (posts via the existing
  folio payments route), then check in. Removes the current "leave the desk, edit
  the reservation, come back" loop.
- **No-show action** on the arrivals tab (`status` API already supports
  `RESERVED → NO_SHOW`; Night Audit auto-flips, but the desk needs the manual
  button for mid-day decisions).
- **Walk-in room booking:** a compressed create-reservation dialog from the Front
  Office page (today's dates, one room, guest picker/quick-create) that checks in
  immediately. Reuses the reservations POST + check-in routes.
- **Guest lookup:** a search box over arrivals/in-house/departures (name, room,
  confirmation #).
- **Cashiering completions:** persisted/printable end-of-shift report + historical
  shift list (data already exists on `CashierShift`), paid-out/petty-cash posting,
  per-method breakdown on close. Defaults (float 300, USD/MVR) become settings,
  not hardcodes.

## Phase 2 — Reservations robustness ⬜

- **Reservation detail page** (`reservations/[id]/page.tsx`) — the module's biggest
  structural gap. One page showing: stay summary + status timeline, room
  assignments/segments, folio(s) summary with link to panel, allocations, traces,
  accompanying guests, remarks, actions (check-in/out, move, cancel, letter,
  email). Fixes the group-page 404 links for free and gives traces/room-move a
  home inside the module (today they're Front-Office-only).
- **List page: server-driven search / filters / pagination.** `GET
  /api/reservations` gets `status`, date-range, and text-search params plus real
  pagination (today: silent `take: 100` cap, no filters, and the list
  eager-loads folios/allocations/tasks it never displays — slim the payload).
- **Group blocks become editable.** `groups/[id]` is GET-only — a block's status
  (`TENTATIVE → DEFINITE / CANCELLED`), cutoff date, and rooms-held can never
  change after creation, yet pickup logic guards on `CANCELLED`. Add PUT/PATCH
  with guards (can't shrink held below picked-up, cancel requires no active
  pickups or confirms them). Pickup dialog gets rate-plan/meal-plan choice
  (today: silently lowest-priority plan + `mealPlanCode: "NONE"`).
- **BookingForm rebuild onto APP STANDARD 001** (Zod + RHF + shadcn): it's 1,160
  hand-rolled `useState` lines with imperative validation and
  `JSON.stringify(err)` shown to users. Split into subcomponents (stay grid,
  guest section, allocations, quote) while porting.
- **Tape chart, after the Phase 0 fixes:** pick ONE implementation to invest in
  (recommend `tape-chart-grid.tsx`, which already has drag-drop reassign) and add:
  click-empty-cell → prefilled new booking, bar context actions (check-in, folio,
  detail page), stay-extend/shorten via edge drag as a stretch goal. Retire or
  demote the read-only calendar view to avoid maintaining two charts.

## Phase 3 — Housekeeping & Maintenance lifecycle ⬜

- **Couple task completion ↔ room status** (today fully decoupled): completing a
  CHECKOUT/cleaning task offers/sets the room CLEAN; marking a room CLEAN
  auto-completes its open cleaning tasks. Define the one true lifecycle
  (DIRTY → CLEAN → INSPECTED) and make INSPECTED mean something (e.g. a property
  setting "arrivals require inspected room" that gates check-in the way DIRTY
  warns today) — or drop it.
- **Out-of-Order becomes a real feature:** board UI to set OOO/OOS with a reason
  and an **expected-return date** (new nullable fields on `Room` or a small
  `RoomStatusBlock` model — decide during design); a maintenance ticket can take
  the room OOO at creation and return it to DIRTY on resolve. Today a "HIGH,
  room flooded" ticket leaves the room fully sellable — the single biggest
  operational gap in the module.
- **Attendant task sheets:** a per-attendant view ("my rooms today", ordered by
  arrival priority) usable on a phone. Also resolve the split assignment model:
  `Room.assignedAttendantId` → `User` vs. `HousekeepingTask.assignedToId` →
  `RoomAttendant` (never populated by anything) — collapse to one.
- **Arrival-priority signalling on the board:** tiles show due-out / arriving-today
  / stayover chips so attendants clean in the right order (data already available
  from reservations).
- **Board filters** (status, attendant, floor, dirty-only) + lightweight polling or
  refetch-on-focus (today: manual Refresh on housekeeping, *nothing* on the
  maintenance kanban — it fetches once on mount and goes stale).
- **Unify the maintenance API surface:** two create shapes (`maintenance` POST
  single vs `housekeeping/maintenance` POST bulk), two update conventions
  (body-based vs RESTful `[id]`), two UIs (kanban + `WorkOrderManager` on the
  inventory page) with divergent issue-type lists, and bulk tickets hardcoded to
  MEDIUM priority. Converge on the RESTful routes + one shared form component
  with a priority picker.

## Phase 4 — Cross-cutting robustness (applies to all three modules) ⬜

- **Zod on every API body** in these modules (today: manual `if (!body.x)` checks;
  `status`/`priority`/`taskType` accept arbitrary strings straight into the DB).
  Same enum validation the hardened routes already have.
- **Forms standard compliance sweep** beyond BookingForm: folio charge/payment,
  cashiering open/close/exchange, void reason, maintenance/assign dialogs — all
  raw `useState` today.
- **Kill `alert()` / dialog-based notifications** in favor of the toast pattern;
  stop rendering raw error JSON; add error states to the silent
  `console.error`-only fetches (housekeeping/maintenance mutations currently
  no-op on failure without reverting optimistic updates).
- **Typed API contracts** for the module payloads (today `any` throughout);
  slim over-fetching responses (`front-office/summary` returns full Prisma
  objects incl. PII/financials; reservations list eager-loads unused relations;
  summary has an N+1 per room-move segment).
- **Remove dead/misleading leftovers:** `folio-panel.tsx` still sends
  `shiftId: "mock-shift-id"` (server ignores it), delete-button shown for
  undeletable reservations, hardcoded `$` symbols regardless of property
  currency.
- **Decompose the monoliths** as they're touched (don't do a big-bang refactor):
  `booking-form.tsx` 1,160 · `folio-panel.tsx` 766 · `reservations/page.tsx` 604
  · `front-office/page.tsx` 578 · `cashiering/page.tsx` 495 ·
  `housekeeping/page.tsx` 487.

## Carried-over P1s from the Alpha-3 audit (unchanged, still open)

- Financial audit-trail table (schema migration; UserActivityLog covers actions
  but not immutable financial postings).
- Optimistic concurrency (updatedAt-based) on money-touching writes.
- SMTP password encryption at rest (blocked on a key-management decision from the
  app owner) — redaction shipped, encryption didn't.
- Backup story (Litestream or equivalent) for the SQLite production database.
- Manual UI pass on the platform-admin console (blocked last session by a sandbox
  networking issue) and the Profiles-redesign click-through.

## Suggested order & verification

Phase 0 first (each item independently shippable, most are < 1 session), then
Phase 1 → 2 → 3 (each is a coherent owner-reviewable feature drop), with Phase 4
folded into whichever module is being touched rather than run as its own pass.
Every phase keeps the established bar: Vitest coverage for new business rules
(`tests/business-rules/`, `tests/tenant-isolation/`), `tsc --noEmit` clean, and a
live browser verification pass before calling it done.

Open decisions — **all five answered by the app owner 2026-07-21**, full wording
in [DECISIONS.md](DECISIONS.md) "Alpha v4 owner decisions". Summary:
1. Vacant-rooms KPI: keep Phase 0's shipped semantics (total vacant + ready
   subcount). ✅
2. Deposits: a **real pre-arrival deposit concept** — collectable while RESERVED,
   visible on manage reservation, auto-transfers to the folio at check-in;
   payments acceptable any time during the stay. (Phase 1 — the larger build.)
3. INSPECTED **gates arrivals via a per-property toggle**. (Phase 3)
4. OOO: **fields on `Room`** (`oooReason`, `expectedReturnDate`), no history
   model. (Phase 3)
5. **Availability Matrix survives**; calendar view retires after Phase 2's
   additions land. (Phase 2)
