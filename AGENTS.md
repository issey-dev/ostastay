<!-- BEGIN:project-docs -->
# Project docs — read this first

This is a team project (multiple contributors, human and agent). Before starting work,
read `.agents/docs/`:
- [`.agents/docs/MASTER_PLAN.md`](.agents/docs/MASTER_PLAN.md) — the multi-tenancy/RBAC
  architecture retrofit: context, architecture decisions, phase-by-phase status
  (Phase 0-4 done, Phase 5-6 not started).
- [`.agents/docs/TODO.md`](.agents/docs/TODO.md) — the actionable remaining-work list:
  what's left, what was deliberately deferred, what was found broken along the way but
  is out of scope to fix without asking first. **Update this file** when you close or
  discover an item — it's how the next session (yours or a teammate's) knows what's
  still open without reading chat history.
- [`.agents/docs/DECISIONS.md`](.agents/docs/DECISIONS.md) — business rules and design
  decisions the app owner has given verbally, dated. Check here before assuming a
  business rule, especially around Room Types, Tax/Charge Codes, Sequence Manager, and
  theming.
- [`.agents/docs/FORM_VALIDATION_STANDARD.md`](.agents/docs/FORM_VALIDATION_STANDARD.md)
  — APP STANDARD 001: every form must use Zod + React Hook Form + shadcn/ui with
  inline, real-time validation.
- [`.agents/docs/ALLOCATIONS_PLAN.md`](.agents/docs/ALLOCATIONS_PLAN.md) — Master Plan
  v2: the Allocations revenue-model extension (per-person priced components linked to
  rate plans/meal plans/reservations, posted at Night Audit). Read before touching
  Revenue, Meal Plans, or Night Audit posting.

[`.agents/docs/DESIGN_PLAN.md`](.agents/docs/DESIGN_PLAN.md) is the full design-token/
theming plan (large, kept separate) — `.agents/docs/DECISIONS.md` has a short pointer to
it plus a status correction (its own header is stale — treat it as partially-to-mostly
implemented, not "planning only").
<!-- END:project-docs -->

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:ui-components-standard -->
# App Standard Components

When building forms or pages that require dropdowns or selects, use the standard custom component `SearchableSelect` located in `src/components/ui/searchable-select.tsx` if there are many options that would benefit from search/filtering. 
Do not implement standard `Select` for long lists (e.g., Guests, Rooms). 

Usage Example:
```tsx
import { SearchableSelect } from "@/components/ui/searchable-select"

<SearchableSelect
  value={value}
  onChange={(v) => setValue(v)}
  placeholder="Select Item..."
  options={items.map(item => ({ label: item.name, value: item.id }))}
/>
```
<!-- END:ui-components-standard -->

<!-- BEGIN:date-picker-standard -->
# Date Pickers
- Always use `@/components/ui/date-picker` for single dates. It natively supports year/month dropdowns.
- Always use `@/components/ui/date-range-picker` for date ranges (e.g., check-in and check-out periods).
<!-- END:date-picker-standard -->
