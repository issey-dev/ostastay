# Charge Code System — Audit Findings & Redesign Plan

**Status:** Planning only. Nothing in this document is implemented. No code or schema
change has been made. This file captures the financial audit of the charge-code layer
and proposes a three-level, Opera-modelled replacement.

**Scope:** the `ChargeCode` model, everything that posts a `FolioLineItem` against it,
the tax resolution path, and every report/document that reads charge classification.

---

## 1. Audit findings

### 1.1 Current `ChargeCode` model (`prisma/schema.prisma:539`)

```prisma
model ChargeCode {
  id            String      @id @default(uuid())
  enterpriseId  String
  enterprise    Enterprise  @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  code          String
  description   String
  // Grouping for reporting only — ROOM | FOOD_BEVERAGE | TRANSPORTATION | OTHERS | TAX | SYSTEM.
  // (PAYMENT was removed — payment types are Payment Methods, not charge codes.)
  category      String      @default("OTHERS")
  useDefaultTax Boolean     @default(true)
  taxProfileId  String?
  taxProfile    TaxProfile? @relation(fields: [taxProfileId], references: [id])

  folioLineItems FolioLineItem[]
  outletCharges  OutletChargeCode[]
  allocations    Allocation[]
  ratePlans      RatePlan[]
  routingRules   FolioRoutingRule[]
  feeRules       PropertyFeeRule[]
  excursionTypes ExcursionType[]
  spaTreatments  SpaTreatment[]

  @@unique([enterpriseId, code])
}
```

Key structural facts:
- **Flat model.** One `category` string is the only grouping dimension. There is no
  sub-classification, no group hierarchy, and no per-code posting metadata.
- `category` is a **free string with a schema `@default("OTHERS")`**, not an enum — so
  the "canonical list" lives only in comments and in scattered validation arrays.
- Tax attaches directly to the code via `useDefaultTax` / `taxProfileId`. This part is
  clean and should be preserved (see §1.5).
- `code` is unique per enterprise (`@@unique([enterpriseId, code])`), which is what all
  the hardcoded `code: "ROOM"` lookups rely on.

### 1.2 Hardcoded charge-code strings

The runtime assumes two magic codes exist per enterprise: **`ROOM`** (accommodation) and
**`GTX`** (Green Tax). Confirmed hardcoded lookups / comparisons:

| Location | Usage |
|---|---|
| `src/app/api/night-audit/run/route.ts:117` | `findFirst … code: "ROOM"` for nightly room charge |
| `src/app/api/night-audit/run/route.ts:143` | `findFirst … code: "GTX"` for Green Tax line |
| `src/app/api/reservations/[id]/advance-bill/route.ts:94` | `code: "ROOM"` fallback |
| `src/app/api/reservations/[id]/advance-bill/route.ts:98` | `code: "GTX"` |
| `src/lib/reservation-quote-server.ts:144` | `where … code: "ROOM"` |
| `src/app/api/folios/[id]/invoice-data/route.ts:211,218,224` | literal `code: "ROOM"` / `"GTX"` on proforma lines |
| `src/lib/reports/defs/financial.ts:191,304` | `chargeCode?.code === "GTX"` (green tax is not GST-bearing) |
| `src/lib/eod-reports.ts:189` | `category === "ROOM"` room-revenue bucketing |
| `src/lib/reports/defs/revenue.ts:173` | `chargeCode?.category === "ROOM"` |
| `src/components/print/stationery/sample.ts:88,91` | sample data uses `"ROOM"` / `"GTX"` |

Dev seed scripts, by contrast, create codes named **`RM`** and **`FB`** — different from the
`ROOM`/`GTX` the runtime looks up. So a database seeded by the dev scripts still fails
Night Audit, because the runtime `findFirst({ code: "ROOM" })` returns null.

`EnterpriseSettings.defaultAccommodationChargeCodeId` (`schema.prisma:1393`) is used as a
*softer* fallback for accommodation only (rate plan → enterprise default → literal
`"ROOM"`). There is **no** equivalent fallback for `GTX` or any other code.

### 1.3 Provisioning gap

`src/app/api/properties/route.ts:40-64` creates a new property and a locked **`BASE`** rate
plan — but **never creates `ROOM` or `GTX` charge codes** (nor any charge codes at all).

Consequences:
- Night Audit returns **HTTP 400** when the `ROOM` code is missing.
- The magic codes exist **only** if someone ran the dev seed scripts — and those create
  `RM`/`FB`, not `ROOM`/`GTX` (§1.2), so even the seed path doesn't satisfy the runtime.
- A freshly onboarded production property is effectively unable to run Night Audit until
  a human manually adds charge codes with exactly the right code strings.

### 1.4 Category contradiction — no single canonical list

Three different "authoritative" category lists disagree:

| Source | List |
|---|---|
| `schema.prisma:545` comment | `ROOM \| FOOD_BEVERAGE \| TRANSPORTATION \| OTHERS \| TAX \| SYSTEM` |
| `src/app/api/charge-codes/route.ts:7` & `charge-codes/[id]/route.ts:7` | adds **`NON_REVENUE`** (for TA commissions) — schema never updated |
| `src/app/api/reports/options/route.ts:33` | `ROOM \| FOOD_BEVERAGE \| TRANSPORTATION \| OTHERS \| TAX \| SYSTEM` (drops `NON_REVENUE`) |
| `.agents/docs/DECISIONS.md` | says **`PAYMENT` was removed** |
| Code reality | `"PAYMENT"` still used as an audit **action** in `payments/route.ts:100` and `folios/[id]/payments/route.ts:71` (that's a different field — audit action, not a category — but it muddies grep results and intent) |

`NON_REVENUE` was bolted onto the live API for commission postings without a schema
change or a migration to the enum, so the schema comment, the write validation, and the
report options are now mutually inconsistent.

### 1.5 Tax engine (healthy — preserve as-is)

`src/lib/tax-calc.ts` is the single shared tax engine:
- `resolveChargeTax(...)` (`tax-calc.ts:117`) — resolves a charge's tax from either the
  enterprise default engine (Service Charge → TGST) or the code's custom `taxProfile`,
  honouring `effectiveFrom`/`effectiveTo` windows and `pricesIncludeTaxes`.
- `resolveOutletChargeTax(...)` (`tax-calc.ts:148`) — thin wrapper that substitutes an
  outlet's tax override (`NONE` / `DEFAULT_ENGINE` / `CUSTOM`) before delegating, so the
  BASE/COMPOUND math is never duplicated.

Night Audit, POS charge, and folio line-item routes all post through this engine. **No
inline tax math** exists in those modules. The redesign must keep this the single tax
authority and route the new posting service through it unchanged.

### 1.6 Financial write sites (post `FolioLineItem`)

Every site below creates folio line items and must be reviewed against the new posting
service. The brief listed four; the grep surfaced more:

| Write site | Notes |
|---|---|
| `src/app/api/night-audit/run/route.ts` | nightly room + green-tax postings |
| `src/app/api/pos/charge/route.ts` | outlet / POS charges (uses `resolveOutletChargeTax`) |
| `src/app/api/folios/[id]/line-items/route.ts` | manual folio postings |
| `src/app/api/reservations/[id]/advance-bill/route.ts` | advance billing |
| `src/app/api/spa/appointments/route.ts` | **spa treatment postings (not in original list)** |
| `src/app/api/excursions/bookings/route.ts` | **excursion postings (not in original list)** |
| `src/app/api/reservations/[id]/status/route.ts` | **status-change side postings (not in original list)** |
| `src/app/api/reservations/[id]/check-out/route.ts` | **commission credit line at checkout (not in original list)** |
| `src/app/api/excursions/departures/[id]/move-bookings/route.ts` | **re-posting on move (not in original list)** |
| `src/lib/special-requests.ts` | **special-request fee postings (not in original list)** |
| Payments / voids / adjustments | `payments/route.ts`, `folios/[id]/payments/route.ts` — audit-action `"PAYMENT"`/`"REFUND"`, `isVoid` toggling. Need a final sweep to confirm none bypass the posting service. |

### 1.7 Reporting consumers (read `ChargeCode.category` / `.code`)

- `src/lib/reports/defs/revenue.ts` — room vs other via `category === "ROOM"`.
- `src/lib/reports/defs/financial.ts` — GST base excludes `code === "GTX"`.
- `src/lib/eod-reports.ts` — day room revenue via `category === "ROOM"`.
- `src/app/api/reports/options/route.ts` — category filter options.
- Folio / AR invoice rendering (`folios/[id]/invoice-data`, print stationery).
- **`src/app/api/analytics/route.ts:66` — confirmed field contradiction:**
  ```ts
  const category = item.chargeCode?.code || "OTHER"   // reads .code
  if (category === "ROOM") { roomRevenue += amount }    // compares as if category
  ```
  The variable is named `category` but assigned `.code`; `revenueByCategory` is then keyed
  by **code**, not category, while every other report keys by **category**. Room revenue
  here only works by the accident that the code string happens to equal `"ROOM"`.

---

## 2. Proposed model — three-level hierarchy (Opera-modelled)

Replace the single flat `category` string with an explicit **Group → Subgroup → Code**
hierarchy, mirroring Opera PMS transaction-code structure. Classification becomes real FK
relations, not magic strings, and posting behaviour moves onto the code row.

```
ChargeGroup            (e.g. ACCOMMODATION, FOOD_BEVERAGE, TRANSPORT, OTHER, TAX, NON_REVENUE, SYSTEM)
  └─ ChargeSubgroup    (e.g. ROOM_REVENUE, EXTRA_OCCUPANCY  under ACCOMMODATION)
       └─ ChargeCode   (e.g. ROOM, GTX, the actual posting code)
```

### 2.1 `ChargeGroup`

```prisma
model ChargeGroup {
  id           String          @id @default(uuid())
  enterpriseId String
  enterprise   Enterprise      @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  code         String          // ACCOMMODATION, FOOD_BEVERAGE, TRANSPORT, OTHER, TAX, NON_REVENUE, SYSTEM
  name         String
  // The reporting bucket. Canonical, closed set — this is the ONE list.
  reportBucket String          // ROOM | FOOD_BEVERAGE | TRANSPORT | OTHER | TAX | NON_REVENUE | SYSTEM
  isRevenue    Boolean         @default(true)   // NON_REVENUE / TAX(pass-through) => false
  isSystem     Boolean         @default(false)  // system-managed, not user-deletable
  sortOrder    Int             @default(0)
  subgroups    ChargeSubgroup[]

  @@unique([enterpriseId, code])
}
```

### 2.2 `ChargeSubgroup`

```prisma
model ChargeSubgroup {
  id            String        @id @default(uuid())
  enterpriseId  String
  enterprise    Enterprise    @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  chargeGroupId String
  chargeGroup   ChargeGroup   @relation(fields: [chargeGroupId], references: [id], onDelete: Cascade)
  code          String
  name          String
  sortOrder     Int           @default(0)
  chargeCodes   ChargeCode[]

  @@unique([enterpriseId, code])
}
```

### 2.3 `ChargeCode` (extended)

```prisma
model ChargeCode {
  id               String          @id @default(uuid())
  enterpriseId     String
  enterprise       Enterprise      @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)

  // NEW — hierarchy. Replaces the free-text `category` string.
  chargeSubgroupId String
  chargeSubgroup   ChargeSubgroup  @relation(fields: [chargeSubgroupId], references: [id])

  code             String
  description      String

  // NEW — posting semantics, previously implied by magic code strings.
  postingType      String          @default("CHARGE")   // CHARGE | TAX | CREDIT | NON_REVENUE
  isSystem         Boolean         @default(false)       // ROOM/GTX-class codes: cannot be deleted
  isActive         Boolean         @default(true)

  // Tax — UNCHANGED (see §1.5). Still the code's own attachment.
  useDefaultTax    Boolean         @default(true)
  taxProfileId     String?
  taxProfile       TaxProfile?     @relation(fields: [taxProfileId], references: [id])

  // NEW — declarative link to the generates engine (§4). A code may auto-post child
  // charges (e.g. ROOM generates GTX / bed tax) via ChargeCodeGenerate rows.
  generatesFrom    ChargeCodeGenerate[] @relation("GeneratorCode")
  generatedBy      ChargeCodeGenerate[] @relation("GeneratedCode")

  folioLineItems   FolioLineItem[]
  outletCharges    OutletChargeCode[]
  allocations      Allocation[]
  ratePlans        RatePlan[]
  routingRules     FolioRoutingRule[]
  feeRules         PropertyFeeRule[]
  excursionTypes   ExcursionType[]
  spaTreatments    SpaTreatment[]

  // DEPRECATED — kept only during migration so old readers don't break. Removed in Phase 4
  // cleanup once all consumers read via chargeSubgroup.chargeGroup.reportBucket.
  category         String          @default("OTHERS")

  @@unique([enterpriseId, code])
}
```

### 2.4 `ChargeCodeGenerate` — cascading tax buckets

Opera's "generates" mechanism: posting one code automatically posts derived codes
(taxes, fees, bed levies). Declarative rows instead of hardcoded `GTX` logic.

```prisma
model ChargeCodeGenerate {
  id                String      @id @default(uuid())
  enterpriseId      String
  enterprise        Enterprise  @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)

  // The code whose posting triggers generation.
  generatorCodeId   String
  generatorCode     ChargeCode  @relation("GeneratorCode", fields: [generatorCodeId], references: [id], onDelete: Cascade)
  // The code that gets auto-posted.
  generatedCodeId   String
  generatedCode     ChargeCode  @relation("GeneratedCode", fields: [generatedCodeId], references: [id], onDelete: Cascade)

  // How the generated amount is computed.
  method            String      // PERCENT | FLAT | PER_PERSON_PER_NIGHT
  value             Float       // percent (e.g. 8.0) or flat/per-unit amount
  // What the percent applies to — supports compounding/cascading buckets.
  calculateOn       String      // NET | GROSS | ANOTHER_GENERATE
  basisGenerateId   String?     // when calculateOn = ANOTHER_GENERATE, the upstream row
  sortOrder         Int         @default(0)   // deterministic cascade order

  @@index([enterpriseId, generatorCodeId])
}
```

This turns the hardcoded "ROOM also posts GTX, and GTX is not GST-bearing" logic
(`financial.ts:304`, `night-audit/run:143`) into config: `ROOM` has a generate row →
`GTX` (`PER_PERSON_PER_NIGHT`, flat), and `GTX`'s own `postingType = TAX` /
`useDefaultTax = false` keeps it out of the GST base.

---

## 3. Single posting service

Introduce **one** posting entry point — `src/lib/posting/post-charge.ts` — that every
financial write site (§1.6) calls instead of hand-building `FolioLineItem` rows.

```ts
// Conceptual signature
async function postCharge(tx, {
  folioId,
  chargeCodeId,          // resolved via a code-resolution helper, never a literal string
  inputAmount,
  quantity,
  outletId?, outletCheckId?, roomAssignmentId?, shiftId?,
  reference?, description?,
  date,
  pricesIncludeTaxes,
}): Promise<PostedLines>   // returns the parent line + any generated child lines
```

Responsibilities:
1. Load the charge code with subgroup/group + tax profile + generate rows.
2. Call `resolveChargeTax` / `resolveOutletChargeTax` (§1.5) — **unchanged** engine.
3. Write the parent `FolioLineItem` (amount, taxAmount, serviceChargeAmount).
4. Run the **generates engine** (§4) to post cascading child lines in `sortOrder`.
5. Return everything for audit logging.

Companion **code-resolution helper** — `resolveChargeCode(enterpriseId, role)` — replaces
every `findFirst({ code: "ROOM" })` with a role-based lookup:
`ACCOMMODATION` / `GREEN_TAX` / `COMMISSION` roles resolve through
`EnterpriseSettings.defaultAccommodationChargeCodeId` (+ new
`defaultGreenTaxChargeCodeId`, reuse existing `commissionChargeCodeId`) → group/subgroup →
never a bare literal. Magic strings die here.

---

## 4. Generates engine (cascading tax buckets)

`src/lib/posting/run-generates.ts`, called by `postCharge` after the parent line posts:

1. Fetch `ChargeCodeGenerate` rows for the generator code, ordered by `sortOrder`.
2. Maintain a **bucket map** of already-computed amounts (`NET`, `GROSS`, and each
   generate row's own output keyed by id) so later rows can compound on earlier ones via
   `calculateOn = ANOTHER_GENERATE` + `basisGenerateId`.
3. For each row compute the generated amount by `method`:
   - `PERCENT` → `basisAmount * value / 100`
   - `FLAT` → `value`
   - `PER_PERSON_PER_NIGHT` → `value * persons * nights` (Green-Tax shape)
4. Post each generated amount as its own `FolioLineItem` against `generatedCode`, itself
   passing through `resolveChargeTax` (so a generated code can still carry/omit tax).
5. Guard against cycles (a generator cannot generate itself, directly or transitively).

This replaces the bespoke GTX branch in Night Audit and the advance-bill GTX lookup with
config-driven cascade, and makes bed tax / municipal levies / compounding service charges
expressible without new code.

---

## 5. Phase 3 — modules to change

**Write path (route through `postCharge`):**
- `src/app/api/night-audit/run/route.ts`
- `src/app/api/pos/charge/route.ts`
- `src/app/api/folios/[id]/line-items/route.ts`
- `src/app/api/reservations/[id]/advance-bill/route.ts`
- `src/app/api/spa/appointments/route.ts`
- `src/app/api/excursions/bookings/route.ts`
- `src/app/api/excursions/departures/[id]/move-bookings/route.ts`
- `src/app/api/reservations/[id]/status/route.ts`
- `src/app/api/reservations/[id]/check-out/route.ts` (commission credit)
- `src/lib/special-requests.ts`

**Code-resolution (kill `findFirst({ code: "ROOM"/"GTX" })`):**
- `src/lib/reservation-quote-server.ts:144`
- `src/app/api/folios/[id]/invoice-data/route.ts:211,218,224`
- Both night-audit + advance-bill lookups above.

**Read path (read `reportBucket` via group, not `.category`/`.code` magic):**
- `src/lib/reports/defs/revenue.ts:173`
- `src/lib/reports/defs/financial.ts:191,304`
- `src/lib/eod-reports.ts:189`
- `src/app/api/analytics/route.ts:66` — **also fix the `.code`-labelled-as-`category` bug**
- `src/app/api/reports/options/route.ts:33` — options from `ChargeGroup`, not a literal array

**Validation / admin surface:**
- `src/app/api/charge-codes/route.ts:7` and `charge-codes/[id]/route.ts:7` — drop the
  hardcoded `CATEGORIES` array; validate against `ChargeSubgroup` FKs.
- Charge-code management UI (Controls) — expose Group/Subgroup pickers + generate rows.

**Provisioning:**
- `src/app/api/properties/route.ts` — seed the canonical group/subgroup/code tree
  (incl. system `ROOM`/`GTX`) at onboarding, alongside the `BASE` rate plan.

**Fixtures / samples:**
- `src/components/print/stationery/sample.ts` and dev seed scripts — align to the real
  seeded codes (retire the divergent `RM`/`FB`).

---

## 6. Phase 4 — migration strategy

1. **Additive migration first.** Create `ChargeGroup`, `ChargeSubgroup`,
   `ChargeCodeGenerate`; add `chargeSubgroupId` (nullable initially), `postingType`,
   `isSystem`, `isActive` to `ChargeCode`. Keep `category` in place.
2. **Backfill script** (`scripts/dev-tools/`, mirrors existing `backfill-outlet-codes.ts`
   pattern): for each enterprise, create the canonical group/subgroup tree, then map each
   existing `ChargeCode.category` string → the matching subgroup and set
   `chargeSubgroupId`. Map `NON_REVENUE` → `NON_REVENUE` group. Flag `ROOM`/`GTX` as
   `isSystem = true`. Create generate rows so `ROOM → GTX`.
3. **Idempotent + safe.** Backfill re-runnable; log any code whose `category` doesn't map
   cleanly rather than guessing. Enterprises missing `ROOM`/`GTX` get them created (closes
   the §1.3 provisioning gap for existing tenants too).
4. **Tighten migration.** Once backfill verified everywhere, make `chargeSubgroupId`
   `NOT NULL`.
5. **Cleanup migration (later, gated).** Drop the deprecated `ChargeCode.category` column
   and the dead `EnterpriseSettings.invoiceBrand*` columns are out of scope — only remove
   `category` after every read consumer (§5) is confirmed migrated.

---

## 7. Phased rollout & risks

| Phase | Work | Key risks |
|---|---|---|
| **1. Schema + backfill** | Additive models, nullable FK, backfill script | Category strings that don't map cleanly (`NON_REVENUE` was never in schema); enterprises with no charge codes at all. **Mitigation:** log-don't-guess, create missing system codes. |
| **2. Posting service + generates** | `postCharge`, `resolveChargeCode`, `run-generates` behind the existing tax engine | Double-posting or missing GTX during cutover; cascade cycles. **Mitigation:** wrap in the existing transaction; cycle guard; golden-master a Night-Audit run before/after and diff folio totals. |
| **3. Migrate write + read sites** | Route all §1.6 writers through `postCharge`; all §1.7 readers through `reportBucket` | Financial regressions in revenue/GST reports; the `analytics.ts` `.code` bug must be fixed *with* a report-parity check, not silently. **Mitigation:** snapshot report outputs pre-change and assert equality post-change on a seeded tenant. |
| **4. Tighten + cleanup** | `NOT NULL` FK, drop `category` | Removing `category` while a stray reader still uses it. **Mitigation:** grep must be clean for `.category` on `ChargeCode` before the drop migration; keep the column one release longer than the code change. |

**Cross-cutting risks:**
- **Tax engine is load-bearing and correct today (§1.5)** — the redesign must *wrap* it,
  never reimplement tax math inside the posting service or generates engine.
- **Magic-string blast radius** — `ROOM`/`GTX` are assumed in reports, quotes, invoices,
  and Night Audit. Missing one lookup silently drops revenue attribution. The
  `resolveChargeCode` helper must be the *only* path, enforced by grep + review.
- **Multi-tenant** — every new table is enterprise-scoped with `@@unique([enterpriseId, code])`;
  backfill must iterate per enterprise and never leak codes across tenants.

---

## 8. Out of scope for this plan (flagged, not fixed)

- Removing the deprecated `EnterpriseSettings.invoiceBrand*` columns (`schema.prisma:1406`).
- The audit-action `"PAYMENT"`/`"REFUND"` string in `payments/route.ts:100` — that's an
  `AuditLog.action`, **not** a charge category; left as-is but noted so it stops polluting
  category greps.
- Any change to `PaymentMethod` / settlement flow.
```
