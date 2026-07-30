**OstaStay — Guest House PMS.** A multi-tenant property management system (Next.js 16 /
React 19, Prisma + SQLite). For project status, the architecture retrofit plan, and
open work, see [`.agents/docs/MASTER_PLAN.md`](.agents/docs/MASTER_PLAN.md) and
[`.agents/docs/TODO.md`](.agents/docs/TODO.md) — that's the up-to-date source of truth
for what's done and what's left, kept in-repo so any contributor (human or agent) can
pick up the project's progress without needing prior chat history.

## Version

Current release: **v5.6.0**.

The version lives in `package.json` and is shown to users in the sidebar **Account**
dialog. Each release is tagged `vX.Y.Z` on `master` — bump `package.json` and tag the
release commit together so the two never drift.

## Quick start

Three commands, in order:

```bash
npm install
```

```bash
npm run db:reset
```

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

`npm run db:reset` drops the dev database, replays every migration, and runs the full
seed. If the database is already set up and you only want to re-seed on top of it, run
`npm run seed` instead — the seed is idempotent, so it's safe to re-run any time.

> **The dev server holds a lock on `dev.db`.** Stop it before running `db:reset` or the
> reset fails with "device or resource busy".

## Credentials

Every seeded account uses the password **`password123`**.

| Email | Enterprise | Sees |
|---|---|---|
| `osta@admin.mv` | Osta (platform admin) | The `/osta` console — all enterprises |
| `admin@veyo.mv` | Veyo | Both properties (master admin) |
| `admin.main@veyo.mv` | Veyo | Veyo Beach Resort only |
| `admin.lagoon@veyo.mv` | Veyo | Veyo Lagoon Retreat only |
| `frontdesk@veyo.mv` | Veyo | Front Desk role |
| `housekeeping@veyo.mv` | Veyo | Housekeeping role |
| `spa@veyo.mv` | Veyo | Front Desk role, linked to Spa therapist Aisha Rahman |

Sign in at [`/login`](http://localhost:3000/login) and enter the Enterprise Code
(`osta` or `veyo`), or go straight to [`/e/veyo/login`](http://localhost:3000/e/veyo/login).

Signing in as an Osta user redirects to `/osta`, a separate console from the tenant
dashboard: enterprises, property approvals, module licensing, time-boxed support access
into a tenant's data, and DB health.

## What the seed creates

The business date on both properties is pinned to **2026-08-01**. Postings always land
on the property's current business date, not the wall clock — so everything the seed
creates is dated against that day and the dashboard has live data on first load.

**Veyo Beach Resort** (`VEYO-MAIN`) — 2 room types (Deluxe Beach Villa, Overwater
Suite), 10 rooms, outlets Coral Restaurant + Serenity Spa.

**Veyo Lagoon Retreat** (`VEYO-LAGOON`) — 3 room types (Garden Bungalow, Lagoon Pool
Villa, Family Beach House), 9 rooms, outlets Lagoon Beach Grill + Blue Water Dive
Centre. The **Spa and Excursions modules are set up on this property only**, with
seeded appointments and excursion bookings across the booking lifecycle (confirmed,
checked-in, completed, cancelled) posted to guest folios.

Each property also gets arrivals due today, in-house guests, departures due today,
checked-out history with closed folios, a cancellation, a no-show, future demand, a
group block with room holds and a City Ledger master folio, plus housekeeping tasks
and maintenance tickets.

Financially: a full Opera-style chart of accounts (Charge Group → Subgroup → Charge
Code) with group-level tax generates, so posting a room or outlet charge automatically
posts its service charge and GST as separate linked lines. Every folio line and every
payment is linked to a charge code.

## Development

```bash
npm test
```

```bash
npm run lint
```

Seed scripts live in `scripts/seed/`. They're for internal development and demoing —
they and the credentials above are expected to be removed before a real release, so
don't build any workflow that assumes they exist in production.
