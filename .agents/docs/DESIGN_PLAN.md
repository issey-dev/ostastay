# Design Consistency & Theming Plan — Guest House PMS

Status: **largely implemented**, not "planning only" (this header was stale — see
`git log` commit `4420587 Implement DESIGN_PLAN.md: monochromatic design system +
responsive layouts`, plus `ec30870 Rescope the banner accent from enterprise to
property`, which superseded §3.3 below to be per-property rather than per-enterprise).
Treat this document as a record of the design rationale and target state, verify
against current code before assuming any specific finding/gap listed in §1 is still
open. See [`.agents/docs/DECISIONS.md`](.agents/docs/DECISIONS.md) for a short summary
and the per-property banner correction.
Audience: a coding agent executing this phase-by-phase.
Scope: `D:\OstaStay` (Next.js 16 / React 19 App Router, "Guest House PMS").

**2026-07-31 — this file is now the single source of truth for the design system.** A
separate "5.6 Design System Master" draft briefly existed alongside it; everything in it
that survived review has been folded into §0 (visual language) and §2 (tokens), and the
draft has been deleted so there is only one place to look. Where the draft conflicted
with a decision already taken, the decision won — see §0.4 for the list, so nobody
re-proposes the same reversals later.

---

## 0. Visual language

What the app should feel like. §1–§8 are the mechanics; this is the intent behind them.

### 0.1 The idea

Swiss-modernist discipline, warmed up. Strict grid, clear typographic hierarchy and
mathematical spacing — but printed on paper rather than rendered on glass. Both modes
carry a subtle warm cast: light mode is a warm off-white, dark mode a warm charcoal
rather than a cool slate or OLED black.

The warmth is a **temperature, not a costume**. It lives entirely in the neutrals. There
is no retro styling on top of it: no scanlines, no CRT glow, no pixel fonts, no film
grain, no vintage badges. Someone should notice the app doesn't feel cold, without being
able to say why.

This is a **work tool** for guesthouse operators. Density flexes by surface — ordinary
app screens run medium, data grids (tape chart, rate/availability calendar) run dense —
but always on the same tokens and the same baseline.

### 0.2 House rules

- **No pure white and no pure black.** `#FAF9F6` is the light floor, `#0F0E0C` the dark
  one; ink is `#1C1917`, never `#000000`.
- **No cool greys.** Every neutral carries the warm cast — that consistency *is* the
  effect. One cool grey in the middle of it reads as a bug.
- **One accent at a time**, and it belongs to the property (§2.1, §3.3). Status colors
  are status-only, never decoration.
- **Never signal with color alone.** Status always carries a label, and a dot or icon
  where it needs to read at a glance — channel-sync and reservation states have to be
  legible to colorblind operators.
- **Saturation cap 80%.** No neon, no purple/pink "AI" gradients, no gradients on
  surfaces at all.
- **Icons come from `@/components/icons`**, never `lucide-react` directly (§5.2). No
  emoji in the UI.
- **Numeric columns use `tabular-nums`** so figures align down the column (§2.2).
- **Realistic demo data** — "Beach Villa 01", real MVR/USD amounts, plausible guest and
  channel names. Never lorem ipsum.
- **No AI copywriting clichés** in UI copy: "Elevate", "Seamless", "Unleash", "Next-Gen",
  "Revolutionize".
- **`min-h-*`, never `h-screen`** — mobile browser chrome makes `100vh` wrong.

### 0.3 Density targets

| Surface | Density | Notes |
|---|---|---|
| Ordinary app screens | medium | Standard card/table rhythm, §2.3 |
| Data grids (tape chart, availability, rate calendar) | dense | 36–40px rows, sticky first column + header row |

### 0.4 Settled — do not re-propose

These came up in the 5.6 draft and were decided against. Each reverses a deliberate,
logged choice, so reopening one needs the app owner, not a design argument.

- **Square corners stay.** `--radius: 0px` (§2.4) is a standing "no curves" request from
  2026-07-18, enforced across ~22 files. The draft's 6px/8px radii and 999px pill chips
  are not adopted.
- **One typeface stays.** Inter, with Helvetica ahead of the generic fallback (§2.2). The
  draft's second face (JetBrains Mono for data) is not adopted — `tabular-nums` solves
  column alignment without a second webfont.
- **The accent stays per-property.** The draft proposed one fixed teal for the whole
  product; the accent is chosen per property in Controls (§2.1, §3.3).
- **Toasts stay top-right** (`toaster.tsx`), not bottom-right as the draft specified.

---

## 1. Audit Findings

### 1.1 Stack detection

- **Framework**: Next.js 16 (App Router, Server Components + Server Actions), React 19.
- **Styling**: Tailwind CSS v4 (`@theme inline` token layer in [globals.css](src/app/globals.css)), shadcn/ui on **Base UI** (`@base-ui/react`, not Radix — two Radix packages remain as leftover deps: `@radix-ui/react-dialog`, `@radix-ui/react-label`; verify during migration whether anything still imports them before removing). shadcn style preset is `base-nova` ([components.json](components.json)).
- **Global theme location**: [src/app/theme.css](src/app/theme.css) — CSS custom properties for light (`:root`) and dark (`.dark`) scoped under `@layer base`, imported into [globals.css](src/app/globals.css), which also maps them into Tailwind's `@theme inline` color/radius namespace.
- **Dark mode**: class-based (`.dark` on `<html>`), toggled by [dark-mode-provider](src/components/providers/dark-mode-provider.tsx) + a pre-hydration inline script in [layout.tsx](src/app/layout.tsx) reading `localStorage['theme-mode']`. This part is solid and should be kept as-is.
- **Fonts**: only **Inter** is loaded (`next/font/google` in [layout.tsx](src/app/layout.tsx:6)). No `font-heading` or `font-outfit` family is registered anywhere, despite both being referenced in class names (see 1.4).
- **Testing**: Vitest present but no visual/style regression tooling exists.

### 1.2 Page inventory

Two route trees exist under `src/app`:

| Route | Layout chain | Notes |
|---|---|---|
| `/` | — | Pure redirect to `/dashboard/front-office` |
| `/login` | root only | Public, renders `LoginForm` |
| `/dashboard/[[...rest]]` | root only | **Legacy compat shim** — resolves session, redirects to `/e/{slug}/dashboard/...`. Not a real page, keep as a thin redirect, do not theme. |
| `/e/[slug]/login` | root → `EnterpriseLayout`? (verify: login likely bypasses it) | Enterprise-branded login variant |
| `/e/[slug]/dashboard` (+ 14 subpages: `cashiering`, `controls`, `financials`, `financials/night-audit`, `front-office`, `groups`, `groups/[id]`, `groups/new`, `housekeeping`, `inventory`, `maintenance`, `pos`, `profiles`, `profiles/[upid]`, `profiles/[upid]/edit`, `profiles/new`, `reports`, `reservations`, `reservations/calendar`, `reservations/tape-chart`, `revenue`, `revenue/calendar`, `folios`, `folios/[id]`) | root → `EnterpriseLayout` (slug guard, no chrome) → `DashboardLayout` (sidebar + header + accent injection) | The real app shell. All authenticated work happens here. |
| `/e/[slug]/dashboard/folios/[id]/print` | root only, **no dashboard chrome** | Bespoke print view |
| `/print/folios/[id]` | root only, **no dashboard chrome** | A second, near-duplicate print view (see 1.4) |

**Three layout tiers today**: root (`layout.tsx`) → enterprise slug guard (no visual layer) → dashboard chrome. Print routes intentionally skip the dashboard chrome (correct for print media) but currently do so by hand-rolling every style rather than pulling from tokens (see 1.4).

### 1.3 Component inventory

**Shared primitives** (`src/components/ui/*`, 28 files): shadcn/Base UI wrappers — `button`, `card`, `dialog`, `alert-dialog`, `alert`, `badge`, `dropdown-menu`, `popover`, `select`, `checkbox`, `switch`, `input`, `textarea`, `label`, `form`, `separator`, `sheet`, `sidebar`, `skeleton`, `table`, `tabs`, `tooltip`, `calendar`. Plus **project-specific standard components mandated by `AGENTS.md`**: `searchable-select.tsx`, `date-picker.tsx`, `date-range-picker.tsx` — these are already the canonical choice for their use case and this plan does not replace them, only re-themes them. Also `property-switcher.tsx`, `theme-toggle.tsx`, `system-code-select.tsx`.

**Feature component directories** (bespoke, one per module): `auth`, `controls`, `front-office`, `groups`, `housekeeping`, `inventory`, `profiles`, `providers`, `reservations`, `revenue`, `settings`. These are where drift concentrates — each module re-derives visual patterns instead of composing shared ones.

**Missing shared components** (gap, not inventory of what exists):
- No `StatusBadge`/`StatusPill` component. Status-to-color mapping is hand-rolled independently in at least [room-status-card.tsx](src/components/housekeeping/room-status-card.tsx) and [tape-chart-grid.tsx](src/components/reservations/tape-chart-grid.tsx) (`getStatusColor` defined twice, values not guaranteed to agree).
- No `EmptyState` component — zero matches for the pattern anywhere in `src`.
- No banner/announcement component, despite the app already having "support acting as" (impersonation) session state referenced in [app-sidebar.tsx](src/components/app-sidebar.tsx) and [e/[slug]/layout.tsx](src/app/e/[slug]/layout.tsx), with **no visual indicator** when a support session is active today. This is the natural home for the mandated enterprise-accent banner (§3.3).
- Loading states are inconsistent: 10 files use raw `animate-spin` spinners, only 2 use the shared `Skeleton` primitive.

### 1.4 Inconsistency report (concrete, counted)

**A. Semantic tokens are bypassed at scale.** `theme.css` defines a proper token set (`--background`, `--foreground`, `--muted-foreground`, `--border`, etc.), but components overwhelmingly reach for raw Tailwind palette classes instead:

| Raw class | Occurrences | Should be |
|---|---|---|
| `text-slate-500` | 234 | `text-muted-foreground` |
| `bg-slate-50` | 99 | `bg-muted` or `bg-background` |
| `text-slate-900` | 79 | `text-foreground` |
| `text-slate-400` | 68 | `text-muted-foreground` |
| `text-slate-700` / `text-slate-800` | 50 / 48 | `text-foreground` |
| `border-slate-100` / `border-slate-200` | 47 / 43 | `border-border` |

None of these respond correctly to dark mode the way the token-backed classes already do (some have manual `dark:` siblings bolted on per-instance; most don't — e.g. [app-sidebar.tsx:137](src/components/app-sidebar.tsx:137) `border-t border-slate-200` and `text-slate-500` at line 143 have no `dark:` variant at all, so the sidebar footer is unreadable/inconsistent in dark mode today).

**B. The brand color is hardcoded, which breaks the app's own theming feature.** The app already has a **per-enterprise accent color picker** (`Controls > General` → [themePresets.ts](src/lib/themePresets.ts), 9 presets, injected as an inline `<style>` overriding `--primary`/`--ring`/`--sidebar-primary` in [dashboard/layout.tsx](src/app/e/[slug]/dashboard/layout.tsx:27-31)). But **~175+ call sites** hardcode Tailwind's `indigo` palette directly instead of using the `--primary` token:

`bg-indigo-600` (41), `bg-indigo-700` (33), `text-indigo-600` (31), `bg-indigo-50` (27), `text-indigo-700` (15), `text-indigo-500` (10), `ring-indigo-500` (10), `border-indigo-200` (9), `border-indigo-100` (9).

**Consequence**: if an enterprise picks "Green" or "Zinc" in Controls, the sidebar trigger hover, the header title accents, and every one of those 175+ hardcoded indigo utility usages **stay indigo**. The theming feature only half-works today. This is the single highest-value fix in this plan and directly validates the "single injection point" requirement in §3.2 — the mechanism to do this correctly (a CSS-var override scoped to the dashboard layout) **already exists**, it just needs every consumer to actually reference the token instead of the literal color.

**C. No semantic status-color system.** `theme.css` defines only `--destructive`. Status/feedback colors are chosen ad hoc per component from the raw palette: `emerald` for success (17+12 occurrences across two shades), `rose`/`red` for danger (15+13+27+12), `amber` for warning (14+13+12), `blue` for info (9+9+9). Two independent `getStatusColor` implementations exist with no guarantee their emerald/rose/amber choices agree pixel-for-pixel.

**D. Hardcoded hex outside the token files.** Beyond `theme.css` and `themePresets.ts` (expected — they *are* the token source), raw hex appears in 9 other files, notably:
- [invoice-settings-manager.tsx](src/components/settings/invoice-settings-manager.tsx), [room-manager.tsx](src/components/inventory/room-manager.tsx), [properties-manager.tsx](src/components/settings/properties-manager.tsx), [room-type-manager.tsx](src/components/inventory/room-type-manager.tsx) — all repeat `#4f46e5` (indigo primary) and `#dc2626` (red) as literals, likely color-picker defaults that should reference tokens.
- [print/folios/[id]/page.tsx](src/app/print/folios/[id]/page.tsx) and its near-duplicate [e/[slug]/dashboard/folios/[id]/print/page.tsx](src/app/e/[slug]/dashboard/folios/[id]/print/page.tsx) both hardcode `#4f46e5`, `#1e293b`, `#10b981` — **two separate print views for the same folio, styled independently, drifting from both each other and the app theme.**
- [api/folios/[id]/invoice-data/route.ts](src/app/api/folios/[id]/invoice-data/route.ts) and [api/tenant-settings/route.ts](src/app/api/tenant-settings/route.ts) embed `#4f46e5` server-side (likely in generated PDF/HTML markup) — a token system must reach generated documents too, not just React components.

**E. Duplicate "premium card" elevation recipe, hardcoded to indigo.** Both the `.premium-card` utility in [globals.css:69-74](src/app/globals.css:69) and the shared `Card` primitive itself in [card.tsx:15](src/components/ui/card.tsx:15) independently hand-roll the same hover-lift treatment with an indigo-tinted shadow: `shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)]` → `hover:shadow-[0_8px_30px_-4px_rgba(6,81,237,0.1)]`. This means **every card's shadow stays indigo-tinted even when the enterprise accent is changed or dark mode is active**, and the effect is defined twice with no shared source.

**F. No elevation/shadow token scale.** Alongside Tailwind's own `shadow-sm/md/lg/xl` (83/20/5/4 uses, inconsistent choice per context), there are 5 more one-off arbitrary shadow values (`shadow-[0_1px_3px_0_rgba(0,0,0,0.02)]`, `shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]`, `shadow-[0_0_0_1px_var(--sidebar-border)]`, etc.) — no documented rule for which elevation applies to header vs. card vs. dropdown vs. sidebar.

**G. No z-index scale.** Only 4 raw values in use (`z-10`, `z-20`, `z-30`, `z-50`), low absolute drift, but no named layers — a new modal/toast/banner risks colliding with the sidebar's `z-10` header or Base UI's own portal z-indices.

**H. Radius token exists but is inconsistently consumed.** `globals.css` already derives a full radius scale (`--radius-sm` … `--radius-4xl`) from one `--radius` var — a real token system. But components mix `rounded-lg` (51), `rounded-md` (47), `rounded-xl` (43), and `rounded-2xl` (3, hardcoded directly in `Card` rather than via the `--radius-2xl` token) with no documented rule for which radius tier maps to which component type (button vs. card vs. input vs. avatar/badge, where `rounded-full` is used 50 times).

**I. Motion is fully ad hoc.** Four different unexplained durations in use (`duration-100`×8, `duration-200`×6, `duration-300`×2, `duration-150`×1), a single stray `ease-in`/`ease-linear` (4), and **zero** references to `prefers-reduced-motion` anywhere in the codebase. Loading states are split between raw `animate-spin` (10 files) and the `Skeleton` primitive (2 files), with `animate-pulse`, `animate-ping`, and `animate-bounce` each appearing independently without a documented "when to use which" rule — `animate-bounce` in particular conflicts with the "no bouncy motion" hard constraint and its one call site should be replaced during migration.

**J. Broken font reference.** `font-outfit` is applied in 5 files (e.g. dashboard header title, [dashboard/layout.tsx:39](src/app/e/[slug]/dashboard/layout.tsx:39)) and `font-heading` is baked into the shared `CardTitle` primitive ([card.tsx:41](src/components/ui/card.tsx:41)), but **no such font family is ever loaded** — only Inter is registered in `layout.tsx`. Both classes currently silently no-op to the Tailwind default sans stack. This must be resolved by either loading the intended display font or removing the dead classes — decided in §2.2.

**K. Breakpoints are un-tokenized and tablet is invisible.** `sm:`/`md:`/`lg:`/`xl:` prefixes are used directly and inconsistently (68/48/18/3 call sites) with no documented convention. Separately, [use-mobile.ts](src/hooks/use-mobile.ts) hardcodes a **binary** `768px` mobile/desktop split for the sidebar (collapses to an overlay sheet below 768px, icon-rail sidebar above) — meaning **tablet (768–1024px) is currently bucketed as desktop everywhere**, with no distinct tablet treatment anywhere in the codebase. This is a genuine gap the responsive strategy (§4) must close.

**L. Bright spot — spacing scale is already disciplined.** Padding usage (`p-4`×67, `p-2`×43, `p-0`×40, `p-6`×34, `p-8`×29, `p-3`×26, `p-1`×15, `p-5`×7) sticks almost entirely to Tailwind's default scale; only **one** arbitrary value (`p-[3px]`) exists in the entire codebase. This is the one axis that needs formal documentation more than remediation.

### 1.5 Current theming mechanism (summary)

Theming today is **CSS-variable-based and mostly sound in mechanism, badly under-adopted in practice**:
1. `theme.css` defines light/dark HSL-ish hex pairs under `:root` / `.dark`.
2. `globals.css`'s `@theme inline` block maps those into Tailwind's color/radius utility namespace, so `bg-primary`, `text-muted-foreground`, `rounded-lg`, etc. all resolve correctly today, when used.
3. A per-enterprise accent override already exists as a working proof-of-concept: `resolveThemeColorPreset()` + an inline `<style>` tag scoped to the dashboard layout only (never touches `/login`). This is architecturally very close to what §3.2/§3.3 require — it just needs its scope corrected (from "overrides the global brand color everywhere" to "feeds a reserved accent slot consumed only by sanctioned components") and its actual consumers fixed (findings B and E above).

The gap is not the mechanism, it's **adoption**: a large fraction of components never call into the token layer at all.

---

## 2. Design Tokens

Single source of truth: `src/app/theme.css` (values) + `src/app/globals.css` `@theme inline` block (Tailwind mapping), extended as below. All values are CSS custom properties; nothing is hardcoded in component files after migration.

### 2.1 Color — warm monochrome base + per-property accent

Monochromatic, as before, but the neutrals carry a **warm cast** (hue ~40°, very low
saturation) instead of the cool slate ramp the app started on. Paper, not glass — see
§0.1. Values live in `src/app/theme.css`.

```
                        light        dark
--background            #FAF9F6      #0F0E0C     warm off-white / warm near-black
--foreground            #1C1917      #F5F2EB     warm ink / warm cream
--card, --popover       #FFFEFB      #1A1917     one step off the background, so a card
--card-foreground       = --foreground           reads as a sheet on a desk
--muted, --secondary    #F3F1EB      #272521
--accent  (shadcn's)    = --muted    = --muted
--muted-foreground      #6B6459      #A5A096
--border, --input       #E6E2DA      #4A463D     warm hairline rule
--primary               #1C1917      #F5F2EB     fixed neutral, same for every property
--primary-foreground    #ffffff      #1A1917
```

The shift is deliberately subtle and it **costs no contrast** — every pair was measured
against the previous cool values before landing. Body text stays far above AA in both
modes (16.6:1 light, 17.3:1 dark) and muted text actually improved, 4.55:1 → 5.55:1.

**Status colors** — fixed hues, never accent-dependent, consumed by semantic name only
(and only ever via `src/lib/status-tone.ts`, never a raw Tailwind palette class):

```
                 light      dark       on card (light)
--destructive    #B4402C    #E2795F    5.61:1    brick red
--success        #3F7A52    #6BAF83    5.06:1    muted fern
--warning        #8F6618    #D9A63F    5.10:1    amber-brown
--info           #1F5C99    #5AA0D8    6.83:1    deep sea blue
```

Each has `-foreground` and `-muted` companions. These are deeper and less neon than the
Tailwind defaults they replaced, for two reasons: they sit inside the warm system, and
**the bright originals failed AA as text on a card** — success 3.30:1, warning 2.94:1,
danger 3.76:1. When changing any of them, check three ratios, not one: on `--card`, on
`--background`, and on the token's own `-muted` tint, because `toneMutedClasses()`
renders status text in the status color on that tint.

`--destructive` keeps shadcn's prop name and doubles as the "danger" tone — don't rename it.

**The accent is per-property and chosen in Controls.** There is no single product accent.
Each property picks one in *Controls › General › Appearance*; it is stored as a raw hex on
`Property.bannerColor` and surfaces as the `PropertyBannerBar` line plus a small number of
CSS rules via `--property-accent` (§3.3). "No accent" is a valid, common choice.

The curated presets are named for the Maldivian landscape rather than a generic UI palette
(`src/lib/themePresets.ts`):

| Preset | Hex | White text | Saturation |
|---|---|---|---|
| **Ocean** (default) | `#1A5CA0` | 6.81:1 | 72% |
| **Lagoon** | `#107880` | 5.22:1 | 78% |
| **Palm** | `#2F6B45` | 6.34:1 | 39% |
| **Beach** | `#87703F` | 4.75:1 | 36% |
| **Sunset** | `#B55018` | 5.09:1 | 77% |
| **Coral** | `#C43E63` | 4.98:1 | 53% |
| **Coconut** | `#7E5327` | 6.66:1 | 53% |
| **Orchid** | `#7D4A9E` | 6.28:1 | 36% |
| **Bougainvillea** | `#9C3A8E` | 6.16:1 | 46% |

Three constraints bind every preset, and a new one has to satisfy all three: white label
text clears AA (≥4.5:1) because the picker and any solid accent fill put text on it;
saturation stays ≤80% per §0.2; and lightness stays mid-range so the banner line is
visible against both `--background` values.

Note: shadcn's `--accent` (a hover/muted-surface token, mapped to `--muted`) is unrelated
to the property accent and must not be conflated with it.

**Charts** (`--chart-1..5`) draw from the same six hues — Ocean, Lagoon, Sunset, Palm,
Coral — so a chart never introduces a hue the rest of the app doesn't use. All five are
distinct; `--chart-5` previously duplicated `--chart-1`, which made two series of a
five-series chart indistinguishable.

### 2.2 Typography scale

One family, loaded once. **Decision**: drop `font-outfit`/`font-heading` rather than adding a second font — the audit found no design rationale for a second family, and a monochromatic, restrained system reads better with one voice. Load Inter for both body and headings; delete the dead `font-outfit` class from the 5 files that reference it and repoint `font-heading` (in `CardTitle`) to the default sans stack.

**The stack** (`globals.css`), reaffirmed 2026-07-31 — one webfont, no second face:

```
--font-sans: var(--font-inter), "Helvetica Neue", Helvetica, Arial, sans-serif;
--font-mono: var(--font-sans);
```

Inter is loaded once via `next/font` in `layout.tsx`. Helvetica sits ahead of the generic
fallback deliberately: it's the Swiss grotesque Inter descends from, so the page degrades
to a near-identical shape if the webfont is slow.

**There is no monospace webfont, by design.** Numeric column alignment comes from the
`tabular-nums` utility — Inter ships proper tabular figures — applied to money, date,
count and confirmation-number columns. Use it anywhere digits stack vertically; a folio or
rate grid where the columns don't line up is a bug. `--font-mono` resolves to the sans
stack so existing `font-mono` call sites stay valid; it previously pointed at
`--font-geist-mono`, which is defined nowhere in the repo, so every one of those call
sites was silently resolving to an undefined variable.

```
--text-xs    0.75rem / 1rem      — meta labels, table cell secondary text
--text-sm    0.875rem / 1.25rem  — body default, form inputs, table cells
--text-base  1rem / 1.5rem       — prose, dialog body copy
--text-lg    1.125rem / 1.75rem  — card titles, section headers
--text-xl    1.25rem / 1.75rem   — page sub-headers
--text-2xl   1.5rem / 2rem       — page titles (dashboard header, section landing)
--text-3xl   1.875rem / 2.25rem  — stat/KPI hero numbers only
```

Drop `text-4xl` (1 stray occurrence) — fold into `text-3xl`, no page needs a larger size than a KPI hero number.

Weight scale: `font-normal` (body), `font-medium` (labels, buttons, table headers), `font-semibold` (card/section titles), `font-bold` (page titles only). No other weights permitted.

### 2.3 Spacing scale

Formalize what's already followed (finding L) — Tailwind's default 4px-based scale, explicitly whitelisted for this app:

```
0, 1 (4px), 2 (8px), 3 (12px), 4 (16px), 5 (20px), 6 (24px), 8 (32px), 10 (40px), 12 (48px)
```
No arbitrary `p-[Npx]`/`m-[Npx]`/`gap-[Npx]` values permitted (guardrail, §8). The one existing offender (`p-[3px]`) gets rounded to `p-1` during migration.

Component-internal spacing rhythm (documents current implicit convention):
- Card padding: `--card-spacing` (already a token in `card.tsx`, keep) = `4` default / `3` compact.
- Page content gutter: `4` (mobile) → `6` (tablet) → `8` (desktop), already the pattern in `dashboard/layout.tsx:49`.
- Stack gap between form fields: `4`. Between form sections: `6`. Between page-level sections: `8`.

### 2.4 Radii

**`--radius: 0px`. No curves anywhere in the app.** This is a standing request from the
app owner (2026-07-18) and it supersedes the `0.75rem` scale this section originally
specified — see [`DESIGN_LOG.md`](DESIGN_LOG.md).

The derived scale in `globals.css` is still the right *mechanism*: `--radius-sm` through
`--radius-4xl` are all `calc()`-ed off `--radius`, so this single line squares every
component at once. Per-category radius assignments are therefore moot — there is one
value and it is zero.

Two things are **not** derived from the token and are squared off individually at each
call site, so they need watching in review:

- `rounded-full` — avatars, status dots, pills, switch track/thumb (~22 files swept).
- Hardcoded pixel radii (`rounded-[4px]`, `rounded-[2px]`) — these don't auto-zero either.

If a curve is ever wanted back, change the one token; don't reintroduce per-component
radii. See §0.4 — this has already been proposed and declined once.

### 2.5 Elevation (shadow) scale

Replaces the ad hoc indigo-tinted shadows (findings E, F) with a neutral, token-driven 4-step scale plus a named sticky-header shadow:

```
--elevation-1 (resting card):   0 1px 2px 0 rgb(0 0 0 / 0.04)
--elevation-2 (raised/hover):    0 4px 12px -2px rgb(0 0 0 / 0.08)
--elevation-3 (popover/dropdown): 0 8px 24px -4px rgb(0 0 0 / 0.12)
--elevation-4 (dialog/sheet):     0 16px 40px -8px rgb(0 0 0 / 0.16)
--elevation-header (sticky bar):  0 1px 3px 0 rgb(0 0 0 / 0.06)
```
Dark mode: same recipe, opacity values roughly doubled (dark surfaces need more contrast to read as "lifted"); define `.dark` overrides for each `--elevation-*` var alongside the color tokens in `theme.css`.

`.premium-card` utility and `Card`'s built-in hover treatment (finding E) both consume `--elevation-1` → `--elevation-2` instead of the hardcoded indigo rgba — this single change fixes the "cards stay indigo-tinted regardless of enterprise accent/dark mode" bug for every card in the app in one place.

### 2.6 Breakpoints

Three named device tiers, defined once, consumed everywhere (closes finding K):

```
--bp-mobile:  0        (default, mobile-first base styles)
--bp-tablet:  768px    (Tailwind `md:`)
--bp-desktop: 1024px   (Tailwind `lg:`)
```

Mapping to Tailwind prefixes (no new Tailwind config needed — v4's defaults already align):
- **mobile** = unprefixed base styles, `< 768px`
- **tablet** = `md:` prefix, `768px – 1023px`
- **desktop** = `lg:` prefix, `≥ 1024px`

`sm:` (640px) and `xl:`/`2xl:` remain available for fine-tuning *within* a tier (e.g., a 2-column tablet grid tightening at `sm:` on the small end of mobile) but must never be the primary tier boundary — only `md:`/`lg:` carry tier semantics. `useIsMobile()` in `use-mobile.ts` gets a second consumer-facing export, `useDeviceTier(): 'mobile' | 'tablet' | 'desktop'`, built on the same `matchMedia` pattern at the two breakpoints above, so JS-side layout decisions (not just the sidebar) can key off the same three tiers as CSS.

### 2.7 Z-index layers

Named scale replacing raw numbers (finding G). As implemented in `theme.css`:

```
--z-base:      0     (page content)
--z-sticky:    10    (sticky header, sticky grid header/first column)
--z-banner:    15    (enterprise/support-session banner — above content, below menus)
--z-overlay:   30    (in-page scrims)
--z-modal:     40    (in-page fixed chrome: housekeeping bulk bar, grid loading overlay)
--z-portal:    50    (ALL portaled floating layers — see below)
--z-toast:     60    (toast/notification)
```

(`--z-banner` is `15`, not the `45` this section originally specified — the banner is
page chrome and belongs below menus, not just below toasts.)

**✅ Enforced as of 2026-08-01 (v5.7).** There are no raw `z-50` values left in `src/`
(the sole exception is a `kbd` chip scoped inside the tooltip's own `isolate` context).

**The scale has two bands, and the split is deliberate:**

- **In-page chrome** (`--z-base` … `--z-modal`) stacks by number. These are siblings in
  normal document flow, so their order is fixed by the layout.
- **Portaled floating layers** — `dialog`, `sheet`, `alert-dialog`, `dropdown-menu`,
  `popover`, `select`, `tooltip` — **all share `--z-portal`**. They are portaled to
  `<body>`, so they are siblings whose paint order is decided by **mount order**, which
  is precisely the semantics wanted: the thing opened most recently sits on top.

⚠️ **This section previously prescribed giving the primitives distinct numbers
(`--z-dropdown: 20` … `--z-modal: 40`). Do not do that — it is wrong.** A `Select`
listbox at 20 inside a `Dialog` at 40 renders *behind the dialog that contains it*, and
this app has 20+ files pairing a Select/SearchableSelect with a Dialog. `--z-dropdown`
was removed rather than left as a trap; it had zero consumers.

**`--z-toast` must stay numerically above `--z-portal`.** The `Toaster` mounts once in
the root layout, so it is an early `<body>` child; at an equal z-index a later-mounted
dialog portal wins on paint order and swallows the toast confirming the very action the
user just took inside that dialog. That was a real, shipped bug (both sat at `50`), fixed
in v5.7 by raising toast to `60`. It must not rely on mount order.

### 2.8 Motion tokens

See full rationale in §6. Token definitions:

```
--duration-instant: 100ms   /* micro-interactions: hover, focus ring, active press */
--duration-fast:    150ms   /* small state changes: checkbox/switch toggle, badge appear */
--duration-base:    200ms   /* default: dropdown/popover open, tab switch, accordion */
--duration-slow:    300ms   /* dialog/sheet enter-exit, page section reveal */

--ease-standard: cubic-bezier(0.4, 0, 0.2, 1)   /* default for all state changes */
--ease-out:      cubic-bezier(0, 0, 0.2, 1)      /* entrances (dropdown/dialog opening) */
--ease-in:       cubic-bezier(0.4, 0, 1, 1)      /* exits (dialog closing, toast dismiss) */

--motion-distance-sm: 4px    /* micro-interaction translate (button press, card hover lift) */
--motion-distance-md: 8px    /* entrance translate (dropdown, toast slide-in) */
```

---

## 3. Theming Architecture

### 3.1 Where tokens live

- **`src/app/theme.css`** — sole source of truth for all color, elevation, and (new) status/accent-slot values, light + dark pairs, under `@layer base`. This is the only file where a hex/rgb literal is allowed to appear.
- **`src/app/globals.css`** — the `@theme inline` block maps `theme.css` variables into Tailwind utility namespaces (already the pattern; extend it with `--color-success`, `--color-warning`, `--color-danger`, `--color-info`, plus `--shadow-elevation-*` and `--z-*` mappings so they're usable as `shadow-elevation-2`, `z-modal`, etc. via arbitrary-property-free utilities). Per-property banner color is *not* a shared CSS token — see §3.3.
- **Non-color scales** (spacing, breakpoints, motion durations/easings) are documented in this plan and in `theme.css` as CSS custom properties, but largely **ride Tailwind's existing default scale** rather than inventing a parallel one — the goal is discipline (§2.3, §2.6) not a new system to learn.
- **No theme provider / JS config object.** Given the app is CSS-variable-driven already and works server-side (the accent injection happens in a Server Component via an inline `<style>` tag), introducing a React context/theme-provider layer would be a regression, not an improvement — it would fight the SSR-first architecture. Keep theming as pure CSS custom properties.

### 3.2 How tokens propagate

Unchanged from today's (correct) mechanism: `theme.css` → `@theme inline` → Tailwind utility classes (`bg-background`, `text-muted-foreground`, `bg-success-muted text-success`, etc.) consumed directly in component `className`. Dark mode flips the whole set via the `.dark` class on `<html>`, set pre-hydration (keep the existing inline script — it correctly prevents flash-of-wrong-theme).

**What changes**: components stop reaching around this pipe (finding A) and start consuming it. See §7 migration plan for how that rollout is sequenced.

### 3.3 Property banner accent (the sanctioned escape hatch)

This is the one deliberate exception to "monochromatic everywhere," and it must be narrow by construction, not by convention. **Superseded from the original plan below**: the accent is scoped per-*property*, not per-enterprise, and it renders as a thin 4px line at the top of the page — not a content banner with text — per direct correction from the app owner (an enterprise can have multiple properties; each property gets its own banner color, independent of its siblings).

**Mechanism**:
1. `Property.bannerColor` (nullable `String` on the Prisma `Property` model) stores a raw hex value directly — not a preset name — so a future free-form color picker or additional per-property customization (per the app owner: "just currently a start... more options later on") doesn't need a schema change.
2. `PropertyBannerBar` (`src/components/ui/property-banner-bar.tsx`) is a client component reading `useProperty().currentProperty.bannerColor` and rendering a `h-1` full-width line with that color via inline `style`, or nothing if unset. It lives inside `DashboardLayout`, above the header.
3. Because it reads from the client-side `PropertyProvider` context (not a server-injected CSS variable), it updates live when the user switches properties via `PropertySwitcher` — no page reload, no per-property CSS variable needed at all.
4. `--primary` (used by `Button`'s default variant, links, focus rings, form field focus states, the "brand color" throughout the interactive UI) stays a **fixed neutral**, same for every property, every enterprise, light and dark mode — this is the actual "monochromatic base" requirement: the app's everyday interactive chrome never picks up a property's or enterprise's brand color.
5. The picker that sets it — `PropertyBannerColorManager` (Controls > General > Appearance) — operates on `useProperty().currentProperty`, never an enterprise-wide setting. The preset list is in `src/lib/themePresets.ts` (§2.1), and "No accent" is a first-class, common choice: with `bannerColor` unset, nothing anywhere is accented and the UI is fully monochromatic.
6. For CSS-only consumers, `PropertyAccentScope` injects the hex as `--property-accent`, scoped to the dashboard content area, so shared components can pick it up without each one calling the `PropertyProvider` hook. Dialogs and popovers portal *outside* that scope and therefore never inherit the accent — intentional.

**Sanctioned accent surfaces** (exhaustive list — nothing else may use it):
- `PropertyBannerBar` — the thin top-of-page line, read directly from `Property.bannerColor`.
- **Card headers** — a 2px inset edge beside the title only, via `--property-accent`. A short edge on the header, deliberately not a full-height rail down the card.
- **The active sidebar item** — a low-alpha `color-mix` wash (12% light / 20% dark), not a filled pill.
- Nothing else. Explicitly **not** sanctioned: buttons, focus rings, links, chart series colors, status/badge colors, the login page (the property isn't known pre-login). If a future request wants the accent somewhere else, that's a scope change to this document, not a silent expansion.

(The original plan said the accent had exactly one consumer. Two quiet CSS surfaces were added since — the card-header edge and the sidebar wash — and are listed above. Both stay within "a quiet touch": neither carries text, so neither introduces a contrast dependency on the chosen color.)

**Separately**: the "support session acting-as" indicator (`SupportSessionNotice`, `src/components/ui/support-session-notice.tsx`) is *not* part of this accent system — it's a security notice, styled with the fixed `warning` status tone so it's never recolored to something low-contrast or easy to miss, regardless of which property's banner color happens to be active.

### 3.4 How a page/component is expected to consume tokens

Contract for the migration and for all new code:
- Colors: semantic Tailwind utility only (`bg-card`, `text-muted-foreground`, `border-border`, `bg-success-muted text-success`). Never a raw palette class (`slate-500`, `indigo-600`, `emerald-100`, …) and never a hex literal in a `.tsx`/`.ts` file.
- Radius/shadow/spacing: scale utilities only (`rounded-lg`, `shadow-elevation-2`, `p-4`) per the category mapping in §2.3–2.5. No arbitrary-value classes (`rounded-[10px]`, `shadow-[...]`, `p-[13px]`) outside `theme.css` itself.
- Breakpoints: `md:`/`lg:` for tier changes, `sm:`/`xl:` only for intra-tier refinement (§2.6).
- Motion: `duration-*`/`ease-*` tokens only, per §6.

---

## 4. Responsive Strategy

Mobile-first throughout: base (unprefixed) styles target mobile, `md:` layers on tablet adjustments, `lg:` layers on desktop. Three tiers per §2.6.

### 4.1 Dashboard shell (sidebar + header + content)

| | Mobile (<768px) | Tablet (768–1023px) | Desktop (≥1024px) |
|---|---|---|---|
| Nav | Sidebar hidden, opens as an overlay `Sheet` on trigger tap (already implemented via `useIsMobile()`/Base UI sidebar `isMobile` branch — keep) | Icon-rail collapsed by default on first load (a saved cookie preference always wins), never auto-re-expanded — implemented in `ui/sidebar.tsx`'s `appliedTierDefault` effect. | Icon-rail collapsible sidebar, user-togglable expanded/collapsed, state persisted (existing `SidebarProvider` behavior — keep) |
| Header | Full-width, `PropertySwitcher` collapses to icon-only trigger if it doesn't fit (needs a width check — currently unconditionally rendered inline, verify it wraps gracefully) | Full-width, all header items inline | Full-width, all header items inline (unchanged) |
| Content gutter | `p-4` | `p-6` | `p-8` (already the pattern at `dashboard/layout.tsx:49`, just formalize the `md:p-6` step that's currently skipped — today it jumps straight from `p-4` to `md:p-8`) |
| Content max-width | full | full | `max-w-7xl` centered (existing, keep) |

### 4.2 Data tables (reservations, profiles, groups, inventory lists)

- **Mobile**: switch from `<table>` to a stacked card-per-row pattern (each row's key/value pairs stacked vertically inside a `Card`). This is a genuine layout fork, not fluid scaling — tables under ~500px are unreadable regardless of font/spacing tuning.
- **Tablet**: real `<table>`, horizontally scrollable within a bounded container (`overflow-x-auto`) if columns exceed viewport, sticky first column for identity (name/room number) where the table is wide (e.g. tape chart, reservations grid).
- **Desktop**: real `<table>`, full column set visible without scroll for standard lists; wide grids (tape chart) keep horizontal scroll with sticky first column at every tier.

### 4.3 Forms (profile edit, reservation creation, settings managers)

- **Mobile**: single column, full-width fields, `SearchableSelect`/`DatePicker` open as full-screen sheets rather than anchored popovers (Base UI popover positioning degrades on small viewports).
- **Tablet**: 2-column grid for short paired fields (first/last name, check-in/check-out), single column for long fields (address, notes).
- **Desktop**: 2–3 column grid depending on form density; sidebar-style live summary panel (e.g., folio total while editing charges) becomes a fixed-position side panel instead of stacking below the form.

### 4.4 Dense operational views (tape chart, POS, cashiering)

These are the highest-risk layouts for responsive collapse — call out explicitly per the requirement to flag genuinely distinct-per-device components:
- **Tape chart grid**: desktop/tablet only in its current grid form (horizontal scroll + sticky room column). On mobile, replace with a day-by-day list view (not a fluid shrink of the grid) — this needs a **distinct mobile component**, not responsive classes on the existing grid.
- **POS**: desktop/tablet show item grid + cart side-by-side; mobile stacks cart into a bottom sheet that expands on tap (distinct interaction pattern, not pure reflow).
- **Cashiering / night audit**: primarily numeric/table-driven — fluid scaling (stacked cards on mobile, per §4.2) is sufficient, no distinct component needed.

### 4.5 Print views

Print routes (`/print/folios/[id]`, `/e/[slug]/dashboard/folios/[id]/print`) are **not part of the responsive breakpoint system** — they target print media / PDF rasterization, not viewport width. They still must consume the same color/spacing/radius tokens (closes finding D) so a printed invoice looks like it belongs to the same product, but their layout rules live under `@media print` concerns, not `sm:`/`md:`/`lg:`.

---

## 5. Component Standardization

### 5.1 Duplicates to merge

| Duplicate | Instances | Action |
|---|---|---|
| Print folio view | `/print/folios/[id]/page.tsx` and `/e/[slug]/dashboard/folios/[id]/print/page.tsx` | Merge into one, parameterize the (currently identical-intent) route, delete the other. Both hardcode the same three hex values independently (finding D) — clear signal they were forked, not two intentionally different designs. |
| Status-color resolution | `getStatusColor` in `room-status-card.tsx` and `tape-chart-grid.tsx` | Replace both with the new shared `StatusBadge`/`statusTone()` helper (§5.2). |
| "Premium card" elevation | `.premium-card` utility (`globals.css`) and `Card`'s built-in hover styles (`card.tsx`) | Collapse into one: `Card` owns the elevation treatment via `--elevation-*` tokens (§2.5); delete `.premium-card` and update its ~unknown call sites to plain `<Card>`. |

### 5.2 New canonical shared components

- **`StatusBadge`** (`src/components/ui/status-badge.tsx`) — props `{ tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral', label }`, renders `bg-{tone}-muted text-{tone}` pill using §2.1 status tokens. Replaces both hand-rolled `getStatusColor` functions and any inline status color logic in `front-office`, `housekeeping`, `reservations`.
- **`EmptyState`** (`src/components/ui/empty-state.tsx`) — props `{ icon, title, description, action? }`, standard centered layout, used wherever a list/table currently renders ad hoc "no results" text.
- **`PropertyBannerBar`** (`src/components/ui/property-banner-bar.tsx`) — the sanctioned accent consumer (§3.3), a thin top-of-page line sourced from `Property.bannerColor`. **`SupportSessionNotice`** (`src/components/ui/support-session-notice.tsx`) — the separate, fixed-`warning`-tone support-acting-as indicator; not part of the accent system.
- **Loading**: standardize on `Skeleton` for content that has a known shape (tables, cards, forms) and reserve spinners (`Loader2` + `animate-spin`) only for button-internal loading state and full-page transitions where no shape can be skeleton'd. The 10 existing raw-spinner call sites get triaged individually during Phase 4 (§7) — most list/table loading states convert to `Skeleton`.

### 5.3 Standard state matrix

Every interactive component (`Button`, `Input`, `Select`, `SearchableSelect`, `DatePicker`, `Checkbox`, `Switch`, `Tabs`, table row) must define, at minimum:

| State | Visual rule |
|---|---|
| Default | Base token colors per §2.1 |
| Hover | `--elevation` step up by one (cards/buttons) or background shifts to `--muted` (list rows, menu items) — `--duration-instant` |
| Focus | `focus-visible` ring using `--ring` token (already implemented in `button.tsx` via `focus-visible:ring-3 focus-visible:ring-ring/50` — this is the reference implementation, replicate it, don't reinvent per component) |
| Active/pressed | `translate-y-px` micro-shift (already in `button.tsx`) — `--duration-instant`, no color change |
| Disabled | `opacity-50 pointer-events-none` (already the `Button` pattern — apply uniformly) |
| Loading | Skeleton (content) or spinner-in-place (button label swaps to `Loader2` + dims label, does not change size/layout — prevents layout shift) |
| Error | `border-danger` + `text-danger` helper text below field (form fields); `aria-invalid` styling already exists in `button.tsx`, extend the same token reference to `input.tsx`/`select.tsx` |
| Empty | `EmptyState` component (§5.2), never a bare "No data" string |

---

## 6. Motion System

### 6.1 Principles

Smooth, quiet, purposeful — motion confirms a state change happened, it never performs. No bounce, no overshoot, no attention-seeking easing. This directly reverses the one `animate-bounce` call site found in the audit (finding I) and gives every future "should this animate" question one of four durations and two of three easings to pick from, never a bespoke value.

### 6.2 Durations & easings (tokens defined in §2.8)

| Use case | Duration | Easing |
|---|---|---|
| Hover, focus-ring appear, active press | `--duration-instant` (100ms) | `--ease-standard` |
| Checkbox/switch/badge toggle | `--duration-fast` (150ms) | `--ease-standard` |
| Dropdown/popover/tab-panel open | `--duration-base` (200ms) | `--ease-out` (enter) / `--ease-in` (exit) |
| Dialog/sheet open | `--duration-slow` (300ms) | `--ease-out` (enter) / `--ease-in` (exit) |
| Page/route transition | `--duration-slow` (300ms) | `--ease-standard` |

Rationale for the specific numbers: 100ms is at the low end of "perceptible but not felt as a delay" (below ~100ms reads as instant, which is correct for hover/press feedback that must feel connected to the input). 300ms is the upper bound before a transition reads as sluggish for a UI this information-dense (operational hotel-desk software, used all day — a slow shell costs real time across hundreds of daily interactions). The 150/200ms middle steps exist so small vs. medium UI events are distinguishable without introducing a fifth value.

### 6.3 Page/route transitions

Given this is an operational, data-dense app (not a marketing site), route transitions should be **near-invisible** — a subtle 8px/opacity cross-fade (`--motion-distance-md`, `--duration-slow`, `--ease-standard`) on the content area only, never on the sidebar/header (which should feel static/anchored across navigation, reinforcing that the shell is app furniture, not page content). Do not animate route transitions with a full-page wipe, slide, or skeleton flash — those read as "loading" when the data is often already cached.

### 6.4 Component mount/unmount

Dropdowns, popovers, tooltips, sheets, dialogs: fade + `--motion-distance-md` translate from the trigger direction, using the existing `tw-animate-css` + Base UI `data-[state=open]`/`data-[state=closed]` pattern already wired into `dialog.tsx`/`popover.tsx`/`dropdown-menu.tsx` (`animate-in`/`animate-out`, 12/9 uses found in audit — this infrastructure is correct, it just needs its durations pinned to the token scale instead of each component's current unlisted default).

### 6.5 Loading states

Prefer **skeleton / progressive reveal** over spinners wherever content has a predictable shape (tables, cards, form fields) — per §5.2, this converts 10 existing spinner call sites during migration. Skeletons pulse at `animate-pulse`'s default rhythm (keep Tailwind's built-in timing, don't add a 5th custom duration for this one case). Reserve spinners for: button-internal loading (fixed size, no shape to skeleton) and indeterminate full-page loads (initial auth check, print-page PDF generation wait). Never a layout-shifting spinner that pops in and pushes content — always reserve the space first.

### 6.6 Micro-interactions

Card hover: `--elevation-1` → `--elevation-2` + no more than 2px lift, `--duration-instant`. Button hover: background token shift only (already correct — `bg-primary hover:bg-primary/80`), no scale/translate beyond the existing active-press `translate-y-px`. Nav item active state: background fill + left-border accent tick (neutral color, not brand — since nav is part of the monochromatic shell, not a sanctioned accent surface per §3.3), transition `--duration-instant`.

### 6.7 Reduced motion

Currently **zero** handling exists (finding I) — add globally, once, in `globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This is a single global rule, not a per-component variant — it collapses every token-driven duration to near-zero automatically, so no component needs its own reduced-motion branch as long as it consumes the duration tokens rather than hardcoding timings. Skeletons/spinners lose their pulse/spin animation under this rule too by design (acceptable — a static skeleton shape still communicates "loading" without motion).

---

## 7. Migration Plan

Ordered, independently shippable phases. Each phase should land as its own PR/set of PRs and leave the app in a fully working state — no phase depends on a later phase being complete to be safe to ship.

**Phase 0 — Tokens foundation** (this plan's §2, low risk, no visual change)
1. Extend `theme.css` with the status colors, accent-slot, elevation, and z-index tokens (§2.1, §2.5, §2.7). Extend `globals.css`'s `@theme inline` mapping to expose them as Tailwind utilities.
2. Add the `prefers-reduced-motion` global rule (§6.7).
3. Add `useDeviceTier()` alongside `useIsMobile()` (§2.6).
4. No component changes yet. Ship. Nothing visually changes because nothing consumes the new tokens yet — this phase only makes them available.

**Phase 1 — Shared primitives** (moderate risk, high leverage — touches the most-reused files)
1. Fix `Card`'s hardcoded indigo shadow → `--elevation-*` tokens; delete the now-redundant `.premium-card` utility, migrate its call sites to plain `Card` (§5.1).
2. Fix `Button`, `Input`, `Select`, `Badge`, `Alert` to confirm they're 100% token-driven (spot audit showed `Button` already is — verify the rest).
3. Build `StatusBadge` and `EmptyState` (§5.2). Do not wire them into features yet — this phase just adds the components.
4. Resolve the font question (§2.2): drop `font-outfit`, repoint `font-heading`.
5. Ship. This phase is safe because primitives are additive/corrective in isolation; nothing downstream is forced to change yet.

**Phase 2 — Layout & shell** (moderate risk — the shared shell every page renders through)
1. Fix the accent-injection scope in `DashboardLayout` (§3.3 steps 2–3): stop overriding `--primary`/`--ring`/`--sidebar-primary`, introduce `--accent-enterprise`, pin `--primary` to a fixed neutral.
2. Build `EnterpriseBanner`, wire the "support acting as" variant into the shell (closes a real, currently-invisible UX gap, not just a style fix).
3. Fix the tablet gap in the sidebar (§4.1) and the missing `md:p-6` content-gutter step.
4. This is the riskiest single change in the whole plan (**every** page inherits `DashboardLayout`) — ship behind a manual QA pass across all 14 dashboard subpages in light/dark mode before merging, since automated visual regression tooling doesn't exist yet (see §8 for closing that gap going forward).

**Phase 3 — Page-by-page adoption** (low risk per-page, high total volume — this is where finding A/C's raw-Tailwind-color counts actually get fixed)
Ordered by traffic/risk, each page its own PR:
1. `front-office` (the app's default landing page — highest visibility, do it first while the pattern is freshest)
2. `reservations` + `reservations/calendar` + `reservations/tape-chart` (highest raw-color-count concentration per the audit's file-level grep — biggest single win)
3. `housekeeping`, `maintenance` (adopt `StatusBadge`, retire the two duplicate `getStatusColor`s)
4. `profiles` (+ `new`/`[upid]`/`[upid]/edit`), `groups` (+ `new`/`[id]`)
5. `cashiering`, `pos`, `financials` (+ `night-audit`), `revenue` (+ `calendar`)
6. `inventory`, `reports`, `controls`
7. `login`, `e/[slug]/login` (public pages — confirm they intentionally never see `--accent-enterprise`, per §3.3)

Mechanical per-page checklist: replace raw `slate-*`/`indigo-*`/`emerald-*`/`rose-*`/`amber-*`/`blue-*` classes with semantic tokens; replace any local status-color logic with `StatusBadge`; replace bare "no data" text with `EmptyState`; replace raw spinners with `Skeleton` where content has known shape; apply the `md:`/`lg:` tier convention to any layout that currently only branches at `sm:`.

**Phase 4 — Print & generated documents** (isolated, low risk, but easy to forget)
1. Merge the two duplicate print-folio routes (§5.1).
2. Point the merged print view's colors at tokens instead of the 3 hardcoded hex values.
3. Fix the server-side hex in `invoice-data/route.ts` and `tenant-settings/route.ts` — these generate markup consumed outside the React tree, so they need the token *values* (not Tailwind classes) available server-side; simplest fix is importing the same hex constants from a shared `src/lib/tokens.ts` that both `theme.css` and these routes read from, rather than duplicating literals.

**Phase 5 — Cleanup & guardrails** (closes the loop, prevents regression — see §8)
1. Grep-sweep for any remaining raw palette classes / hex literals outside `theme.css` and `themePresets.ts`; should return zero.
2. Remove now-dead code: the `.premium-card` utility (if not already removed in Phase 1), any now-unused Radix packages if confirmed unreferenced (finding, §1.1).
3. Add the lint guardrails from §8.
4. Document the token system in `AGENTS.md`/`STANDARDS.md` (or equivalent) so future contributors — human or agent — start from the rules instead of rediscovering them.

**High-churn / risky areas to flag explicitly:**
- `reservations/page.tsx` (1003 lines) and `tape-chart-grid.tsx` — largest files, highest raw-color density, and `tape-chart-grid.tsx` needs a genuinely new mobile layout (§4.4), not just a class swap. Budget more review time here than the checklist implies.
- `DashboardLayout` accent-scope change (Phase 2) — blast radius is literally every authenticated page; the fixed fallback (`--primary` → neutral) must be visually verified against all 9 existing theme-color presets before/after to confirm no enterprise's chosen brand color silently vanishes from somewhere it was relied upon (even if that reliance was itself a bug per finding B, a sudden all-tenants visual change warrants a heads-up to whoever owns tenant relationships).
- Print/PDF generation (Phase 4) — anything touching `pdf-lib` output or server-rendered print HTML doesn't get the safety net of hot-reload visual feedback the same way client components do; verify by generating an actual PDF, not just eyeballing the print-preview route.

---

## 8. Guardrails

Prevent the drift documented in §1.4 from recurring:

1. **ESLint rule**: forbid Tailwind color-family utility classes outside the semantic token names. Concretely, disallow `\b(bg|text|border|ring|from|to|via|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]+\b` in `.tsx` files via `eslint-plugin-tailwindcss`'s `no-custom-classname` (allowlisting only the semantic names) or a small custom regex rule if that plugin isn't already a dependency. Exempt `theme.css` (values live there) and `themePresets.ts` (the accent preset source of truth) by path.
2. **ESLint rule**: forbid hex literals (`/#[0-9a-fA-F]{3,8}/`) in `.ts`/`.tsx` files outside `src/app/theme.css`, `src/lib/themePresets.ts`, and (post-Phase-4) `src/lib/tokens.ts`.
3. **ESLint rule**: forbid arbitrary-value Tailwind classes for spacing/radius/shadow (`\[[0-9]+px\]`-shaped `p-`/`m-`/`gap-`/`rounded-`/`shadow-` classes) outside the same token files — enforces §2.3/§8's "no off-scale spacing."
4. **Accent restriction**: a targeted lint rule (or a simple `grep`-based CI check, since this is a single narrow pattern) forbidding `accent-enterprise` in any file under `src/components` **except** `enterprise-banner.tsx` — enforces §3.3's "exactly one consumer" rule mechanically rather than by convention/code review alone.
5. **Component review checklist** (add to PR template or `STANDARDS.md`): any new interactive component must define all 8 states from §5.3 before merge; any new "no data" UI must use `EmptyState`; any new status indicator must use `StatusBadge`.
6. **Motion review checklist**: any new `transition-*`/`animate-*` usage must reference a `--duration-*`/`--ease-*` token, never a bare Tailwind `duration-N`/`ease-N` value — catch in code review until the ESLint rule from item 3 is extended to cover this (durations are trickier to regex-match safely than colors, so start with review, formalize later if drift recurs).
7. **New page checklist**: any new route under `src/app` must specify, in its PR description, which of the three device tiers (§2.6) it was verified against — mobile, tablet, desktop — closing the gap that let tablet silently fall through to desktop treatment (finding K) for as long as it did.
