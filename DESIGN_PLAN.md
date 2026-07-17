# Design Consistency & Theming Plan — Guest House PMS

Status: **planning only** — no code in this document has been applied to the repo.
Audience: a coding agent executing this phase-by-phase.
Scope: `D:\Osta\ostastay` (Next.js 16 / React 19 App Router, "Guest House PMS").

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

### 2.1 Color — monochromatic base scale

Base hue: **slate** (already the dominant palette in the audit — cheapest migration path, zero perceptual change for the majority of the UI). Expressed as a 12-step neutral ramp, light and dark pairs:

```
--neutral-0   (page background, light)   #F8FAFC
--neutral-25                             #F1F5F9
--neutral-50                             #E2E8F0
--neutral-100                            #CBD5E1
--neutral-200                            #94A3B8
--neutral-300                            #64748B
--neutral-400                            #475569
--neutral-500                            #334155
--neutral-600                            #1E293B
--neutral-700                            #0F172A
--neutral-800  (near-black, dark bg)     #020617
--neutral-950  (true black, reserved)    #000000
```

Semantic tokens are **derived from this ramp only** (plus the reserved accent slot below) — no component ever references `--neutral-*` directly, only the semantic names:

```
--background        neutral-0 (light) / neutral-800 (dark)
--foreground         neutral-700 (light) / neutral-25 (dark)
--card               #fff (light) / neutral-600 (dark)
--card-foreground    = --foreground
--popover            = --card
--popover-foreground = --foreground
--muted              neutral-25 (light) / neutral-600 (dark)
--muted-foreground   neutral-300 (light) / neutral-200 (dark)
--secondary          = --muted
--secondary-foreground = --foreground
--border             neutral-50 (light) / neutral-500 (dark)
--input              = --border
```

This is a **relabeling of the existing `theme.css` values**, not a redesign — every hex above is the current slate value already in the file, just given an explicit position on a documented ramp so "which gray do I use" has one answer.

**Status colors** (new — closes finding C), also fixed hues, not accent-dependent, defined once and consumed via semantic name only:

```
--success        #16A34A   --success-foreground #ffffff   --success-muted #F0FDF4
--warning         #CA8A04   --warning-foreground #1E293B   --warning-muted #FEFCE8
--danger          #DC2626   --danger-foreground  #ffffff   --danger-muted  #FEF2F2
--info            #2563EB   --info-foreground    #ffffff   --info-muted    #EFF6FF
```

(`--destructive` stays as an alias of `--danger` for backward compatibility with existing shadcn component variants — do not rename the shadcn-generated prop name, just point it at the new token.)

**Reserved accent slot** (new — the escape hatch, see §3.3):

```
--accent-enterprise            /* set at runtime from tenant config, default = --neutral-600 (i.e. monochromatic no-op) */
--accent-enterprise-foreground /* runtime-computed contrast pair, default = --neutral-0 */
```

Note: `--accent` (shadcn's own hover/muted-surface token, currently mapped to `--muted`) is **unrelated** to `--accent-enterprise` and must not be conflated — keep shadcn's `--accent`/`--accent-foreground` as-is (they're structural, not brand color).

### 2.2 Typography scale

One family, loaded once. **Decision**: drop `font-outfit`/`font-heading` rather than adding a second font — the audit found no design rationale for a second family, and a monochromatic, restrained system reads better with one voice. Load Inter for both body and headings; delete the dead `font-outfit` class from the 5 files that reference it and repoint `font-heading` (in `CardTitle`) to the default sans stack. (If a future rebrand wants a distinct display face, that's a one-line change to add a second `next/font` and a `--font-heading` token — the scale below doesn't need to change for it.)

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

Keep the existing derived scale in `globals.css` (it's already correct in mechanism) but pin explicit usage per component category so `rounded-xl` vs `rounded-2xl` stops being arbitrary:

```
--radius: 0.75rem   (base, unchanged)
--radius-sm   (0.45rem) → inputs, checkboxes, small controls, table row hover
--radius-md   (0.6rem)  → buttons (sm/xs sizes already use this), badges
--radius-lg   (0.75rem) → buttons (default), dropdowns, popovers, tooltips
--radius-xl   (1.05rem) → dialogs, sheets
--radius-2xl  (1.35rem) → cards (fixes finding H — Card moves from hardcoded `rounded-2xl` to `rounded-[var(--radius-2xl)]`)
--radius-full → avatars, status dots, pills/badges, icon-only circular buttons
```

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

Named scale replacing raw numbers (finding G):

```
--z-base:      0     (page content)
--z-sticky:    10    (sticky header — matches current header usage)
--z-dropdown:  20    (dropdown/select/popover menus)
--z-overlay:   30    (sheet/dialog backdrop)
--z-modal:     40    (dialog/sheet content)
--z-banner:    45    (enterprise/support-session banner — must sit above page content, below toast)
--z-toast:     50    (toast/notification — matches current highest usage)
```

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
- **`src/app/globals.css`** — the `@theme inline` block maps `theme.css` variables into Tailwind utility namespaces (already the pattern; extend it with `--color-success`, `--color-warning`, `--color-danger`, `--color-info`, `--color-accent-enterprise`, plus `--shadow-elevation-*` and `--z-*` mappings so they're usable as `shadow-elevation-2`, `z-modal`, etc. via arbitrary-property-free utilities).
- **Non-color scales** (spacing, breakpoints, motion durations/easings) are documented in this plan and in `theme.css` as CSS custom properties, but largely **ride Tailwind's existing default scale** rather than inventing a parallel one — the goal is discipline (§2.3, §2.6) not a new system to learn.
- **No theme provider / JS config object.** Given the app is CSS-variable-driven already and works server-side (the accent injection happens in a Server Component via an inline `<style>` tag), introducing a React context/theme-provider layer would be a regression, not an improvement — it would fight the SSR-first architecture. Keep theming as pure CSS custom properties.

### 3.2 How tokens propagate

Unchanged from today's (correct) mechanism: `theme.css` → `@theme inline` → Tailwind utility classes (`bg-background`, `text-muted-foreground`, `bg-success-muted text-success`, etc.) consumed directly in component `className`. Dark mode flips the whole set via the `.dark` class on `<html>`, set pre-hydration (keep the existing inline script — it correctly prevents flash-of-wrong-theme).

**What changes**: components stop reaching around this pipe (finding A) and start consuming it. See §7 migration plan for how that rollout is sequenced.

### 3.3 Enterprise accent injection (the sanctioned escape hatch)

This is the one deliberate exception to "monochromatic everywhere," and it must be narrow by construction, not by convention.

**Today**: `resolveThemeColorPreset()` overrides the *global* `--primary` token, which — combined with finding B — means the accent leaks into every hardcoded-indigo surface in the app (buttons, links, focus rings, hover states) instead of being contained.

**Target design**:
1. Enterprise config (`EnterpriseSettings.themeColor`, already exists in Prisma) resolves via `resolveThemeColorPreset()` (unchanged) to a `{ primary, primaryForeground }` pair.
2. `DashboardLayout` injects this pair into **`--accent-enterprise` / `--accent-enterprise-foreground` only** — not `--primary`, not `--ring`, not `--sidebar-primary`. Drop those three overrides from the injected `<style>` block ([dashboard/layout.tsx:29](src/app/e/[slug]/dashboard/layout.tsx:29)).
3. `--primary` (used by `Button`'s default variant, links, focus rings, form field focus states, the "brand color" throughout the interactive UI) becomes a **fixed neutral** — the darkest step of the monochromatic ramp (`--neutral-600`/`--neutral-700`) — same for every enterprise, every tenant, light and dark mode. This is the actual "monochromatic base" requirement: the app's everyday interactive chrome (buttons, links, focus) stops being brand-colored at all.
4. `--accent-enterprise` is consumed by **exactly one component category**: the new `EnterpriseBanner` component (§5, closes the "support acting as" gap from finding C in the inventory). No button, link, badge, chart, or table ever reads `--accent-enterprise`.
5. Enforce this at the component boundary, not just by convention: `EnterpriseBanner` is the *only* file in the components tree allowed to reference `bg-accent-enterprise` / `text-accent-enterprise-foreground` — enforced by the lint guardrail in §8.

**Sanctioned accent surfaces** (exhaustive list — nothing else may use it):
- `EnterpriseBanner` — the persistent top-of-shell banner used for (a) "you are viewing as support — acting as {enterprise}" and (b) any future tenant-configurable announcement banner.
- Nothing else. Explicitly **not** sanctioned: buttons, active nav item highlight, focus rings, links, chart series colors, status/badge colors, the login page. If a future request wants the accent somewhere else, that's a scope change to this document, not a silent expansion.

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
| Nav | Sidebar hidden, opens as an overlay `Sheet` on trigger tap (already implemented via `useIsMobile()`/Base UI sidebar `isMobile` branch — keep) | **Currently missing** — today tablet gets the desktop icon-rail treatment. Target: icon-rail collapsed by default (matches desktop's collapsed state), same as desktop, but *never* auto-expanded — reduces content-width pressure on tablet portrait. | Icon-rail collapsible sidebar, user-togglable expanded/collapsed, state persisted (existing `SidebarProvider` behavior — keep) |
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
- **`EnterpriseBanner`** (`src/components/ui/enterprise-banner.tsx`) — the sanctioned accent consumer (§3.3), variant for support-session indicator (fixed copy/icon) and variant for tenant-configurable announcement text (future-ready, config-driven, not built until a config field exists).
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
