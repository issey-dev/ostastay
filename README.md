**OstaStay — Guest House PMS.** A multi-tenant property management system (Next.js 16 /
React 19, Prisma + SQLite). For project status, the architecture retrofit plan, and
open work, see [`.agents/docs/MASTER_PLAN.md`](.agents/docs/MASTER_PLAN.md) and
[`.agents/docs/TODO.md`](.agents/docs/TODO.md) — that's the up-to-date source of truth
for what's done and what's left, kept in-repo so any contributor (human or agent) can
pick up the project's progress without needing prior chat history.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Seed data (internal only — removed before release)

> **These accounts and scripts exist purely for internal development and demoing.**
> Before a real release, all `scripts/seed/*` scripts and the credentials below will be
> deleted — do not build any workflow that assumes they'll still exist in production.

Two independent, idempotent seed scripts (safe to re-run any time, in either order):

```bash
npx tsx scripts/seed/seed-osta.ts             # the Osta platform-admin enterprise
npx tsx scripts/seed/seed-veyo-beach-house.ts # a full demo tenant (wipes & rebuilds "Veyo" each run)
```

All seeded passwords are **`password123`**.

### Logging in as Osta (platform admin)

`scripts/seed/seed-osta.ts` creates the one `INTERNAL` enterprise every other enterprise
is managed through — it never deletes anything (Osta's Role rows are referenced by
every tenant's Users, so wiping it would break every tenant's login).

- **Login**: [`/e/osta/login`](http://localhost:3000/e/osta/login) (or the generic
  [`/login`](http://localhost:3000/login) with Enterprise Code `osta`)
- **User**: `admin@osta.internal` (role `Admin` — full access)

Signing in as an Osta user redirects straight to `/osta`, a completely separate
console from the tenant dashboard:

| Page | What it does |
|---|---|
| `/osta` | Overview — enterprise/pending-approval/support-grant counts |
| `/osta/enterprises` | Every customer enterprise and its properties |
| `/osta/properties` | Approve or reject newly-created properties — a property is locked out of real use until approved here |
| `/osta/licensing` | Per-tier and per-enterprise module enable/disable, property limits |
| `/osta/support-access` | Request/approve time-boxed access into a tenant's own data |
| `/osta/db-health` | Row counts, migration status, and live query performance (this server instance only, since last restart) |

### Logging in as the seeded Veyo tenant

`scripts/seed/seed-veyo-beach-house.ts` builds a complete demo hotel — 4 room types,
15 rooms, 2 outlets, a full chart of accounts, meal plans, 11 rate plans with 2 years
of pricing, and 20 sample profiles — with **no reservations**, so it's a clean baseline
to click around in. Re-running it wipes and rebuilds the whole "Veyo" enterprise from
scratch.

- **Login**: [`/e/veyo/login`](http://localhost:3000/e/veyo/login) (or the generic
  [`/login`](http://localhost:3000/login) with Enterprise Code `veyo`)
- **Users**:
  - `admin@veyo.com` — role `Admin` (full access to the tenant dashboard)
  - `frontdesk@veyo.com` — role `Front Desk`
  - `housekeeping@veyo.com` — role `Housekeeping`

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
