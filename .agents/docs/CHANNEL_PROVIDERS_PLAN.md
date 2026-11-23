# Channel Providers Plan: ZimmerStack now, any channel manager later

Status: **Phase 0 built** on `feat/channel-providers-phase-0` (2026-11-23, not yet merged): pending
inbound bookings and pending channel changes hold rooms in what is pushed (`sync.ts`); immediate
push only on real changes; card data stripped (`core/card-data.ts`, `cardSupplied`, scrub script);
safe auto-cancel vs flag (`inbound/reconcile.ts`, `pendingAction`), reservation-page
`ChannelReviewPanel`, edit-form prefill, notifications `CHANNEL_BOOKING_CANCELLED` /
`CHANNEL_BOOKING_REVIEW`, desk guide section. Phases 1-6 not started. All owner questions
answered 2026-11-23. Written 2026-11-23 against master @ 4200eb68 (v9.10.0).

## Goal

Let each property choose its channel manager. ZimmerStack is added as the second, cheaper
option. Beds24 stays for now but **may be removed entirely later** (owner, 2026-11-23), so a
vendor must be as easy to remove as to add (see "Removing a vendor"). A third (or fourth) vendor must be **one new provider folder plus a
registry line**, with no edits to the sync engine, jobs, routes or screens.

## Principles

1. **The engine is vendor-blind.** `sync.ts`, `push.ts`, `poll.ts`, `ingest.ts`, `convert.ts`,
   jobs, API routes and UI talk to a provider only through `ChannelProvider` and the registry.
   No file outside `src/lib/channels/providers/<vendor>/` imports a vendor module.
2. **Vendors differ by declared capabilities, not by `if (provider === "X")`.** Each provider
   states how it authenticates, how pushes are confirmed, how rates are mapped, etc. The
   engine and screens branch on capabilities.
3. **One contract test suite every provider must pass.** That suite is what makes the next
   vendor safe to add.
4. **The boundary is enforced by a test, not by memory.** A test fails if any file outside
   `src/lib/channels/providers/<vendor>/` imports a vendor module, or if engine code compares
   `provider.id` / `connection.provider` to a literal vendor name.
5. **A deliberately awkward fake vendor lives in the tests** (API key, DEFERRED pushes,
   per-room-type rates, booking ack, PULL sync, per-occupancy prices, card data in bookings). The
   engine must work with Beds24, ZimmerStack AND the fake. If it does, vendor 3 will plug in.
6. **Card details are never stored**, whatever a vendor sends (DECISIONS.md).
7. **Existing rules stay the same for every vendor:** D-7 (publish real inventory, never
   overbook headroom, stop-sale = close), idempotent ingest, raw payload always kept,
   credentials encrypted and never logged.

## What exists today (good foundation)

- `ChannelProvider` interface (`src/lib/channels/provider.ts`) and registry
  (`providers/registry.ts`); `ChannelConnection.provider` column (default `"BEDS24"`).
- Vendor-neutral availability plan (`computeChannelAvailability` in `sync.ts`), the
  provider builds its own wire payload from it.
- Push, poll, ingest, convert and the webhook route already resolve the provider via
  `getProvider()`.

## Where the seam is still Beds24-shaped

| # | Assumption | Where | Why it blocks other vendors |
|---|---|---|---|
| A | Auth = invite code → refresh token → short-lived access token | `provider.ts` auth methods; `refreshToken`/`accessToken` columns; `getValidAccessToken`; keep-alive job | ZimmerStack uses a fixed API key; nothing to refresh or keep alive |
| B | "Has credentials" = `refreshToken != null` | `push.ts`, `poll.ts` (`pollAllConnections`) | An API-key connection looks unconnected and is skipped |
| C | Push succeeds or throws on the spot | `pushAvailability(): Promise<void>` | ZimmerStack returns 202 + batch id; values can be refused later ("sent is not held") |
| D | Rate id = a slot number 1–16, one per rate plan | `isValidRateId`, `ChannelRatePlanMap` (unique `ratePlanId`) | A ZimmerStack rate plan belongs to ONE room type, so one of our plans maps to N external plans |
| E | Prices travel inside the availability payload | `payload.ts` | ZimmerStack has separate availability / rates / restrictions writes (fine: provider can make several calls, but results must be per call) |
| F | Webhook auth = secret in URL, one URL per connection | `api/channels/webhook/[token]` | ZimmerStack signs bodies (HMAC); a partner key has ONE endpoint for all hotels, routed by property id in the body |
| G | Shared types/errors live in the Beds24 client | `ChannelLogSink`, `RateLimitInfo`, `ChannelAuthError`, `ChannelApiError` imported from `beds24.ts` by `provider.ts`, `connection.ts`, 4 API routes; `daysUntilRefreshTokenExpiry` imported by `hub-overview.ts` | Vendor module leaks into engine and routes |
| H | Defaults bake Beds24 in | `ingestBooking` defaults `parse = parseBeds24Booking`; "Beds24" in user-facing strings in `push.ts`/`poll.ts` and 15 `.tsx` files (≈104 mentions) | Wrong parser silently used; UI says Beds24 for a ZimmerStack property |
| I | Platform ("master") account = per-connection tokens | `managedBy: "OSTA"` | A partner/company key is ONE credential covering many properties |

## Gaps that affect EVERY vendor (fix first: Phase 0)

1. **Unconverted inbound bookings don't reduce pushed availability.** `perNightTypeAvailability`
   counts reservations only. An inbound booking sitting in `RECEIVED` (unmapped room, no default
   rate plan, convert job not yet run) is invisible to the next push, and because pushes are
   **absolute counts**, the push re-opens the sold room → double booking. ZimmerStack's docs
   call this out explicitly for website bookings, but it applies to Beds24 too.
   *Fix:* the availability plan subtracts live (non-cancelled) `ChannelInboundBooking` rows with
   status `RECEIVED` for mapped room types. Inbound ingest triggers `pushPropertyNow()`.
2. **Changes after conversion are not applied to the reservation.** Once a booking is
   `CONVERTED`, a later cancellation or date change updates only the inbound row. The
   Reservation keeps holding (or not holding) the room.
   *Fix (owner decided 2026-11-23, DECISIONS.md "Channel bookings changed or cancelled after
   they became a reservation"):* auto-cancel through the normal cancellation path only when
   safe (not checked in, nothing on the folio, not edited by staff since arrival, no linked
   Spa/Excursion/Transfer); otherwise flag. Date/room/other changes are always flagged with an
   old-vs-new view and a one-click "Apply". Notify on every cancellation or change.
   Needs: a "staff edited since channel arrival" marker on the reservation, a pending-change
   record on `ChannelInboundBooking`, and a desk screen/notification to review and apply.

## Target design

### Folder layout

```
src/lib/channels/
  core/                      ← vendor-neutral (moved out of beds24.ts)
    types.ts                 ChannelLogSink, RateLimitInfo, ProviderContext
    errors.ts                ChannelAuthError, ChannelApiError, ChannelRefusedError
  provider.ts                the interface below
  providers/
    registry.ts
    beds24/   index.ts client.ts payload.ts parse.ts       (today's files, moved)
    zimmerstack/ index.ts client.ts payload.ts parse.ts webhook.ts catalog.ts
  ...engine files unchanged in role
tests/channels/provider-contract.test.ts   ← runs against every registered provider
```

### Interface (sketch)

```ts
export type ProviderCapabilities = {
  auth: "REFRESH_TOKEN" | "API_KEY";
  /** One platform credential can serve many properties (Beds24 master account, ZimmerStack company key). */
  partnerAccount: boolean;
  /** IMMEDIATE: push result is final. DEFERRED: push returns a reference that must be checked later. */
  pushConfirmation: "IMMEDIATE" | "DEFERRED";
  /** How our rate plans map to the vendor's prices. */
  rateMapping: "PER_PLAN" | "PER_PLAN_AND_ROOM_TYPE";
  /** Stay rules the vendor can carry beyond stop-sale. */
  restrictions: ("STOP_SELL" | "MIN_STAY" | "MAX_STAY" | "CLOSED_TO_ARRIVAL" | "CLOSED_TO_DEPARTURE")[];
  /** Vendor exposes room types / rate plans to pick from in the mapping screen. */
  catalog: boolean;
  webhookAuth: "URL_TOKEN" | "SIGNATURE";
  /** Separate feed for the hotel's own website bookings (ZimmerStack direct.booking.*). */
  directBookings: boolean;

  // --- Declared now for vendors 3+, even though Beds24 and ZimmerStack don't need them ---
  /** PUSH: we send ARI to the vendor (Beds24, ZimmerStack). PULL: the vendor calls US to read
   *  ARI (e.g. SiteMinder pmsXchange-style XML). PULL is served by the engine from the same
   *  ChannelAvailabilityPlan, through a per-provider inbound ARI endpoint. */
  syncDirection: "PUSH" | "PULL";
  /** Vendor re-delivers a booking until we confirm receipt (e.g. Channex booking revisions). */
  bookingAck: boolean;
  /** ROOM_TYPE: counts per room type (hotels). UNIT: each room is its own listing (holiday-rental
   *  vendors). UNIT providers receive per-room availability, built by the engine, not the provider. */
  inventoryModel: "ROOM_TYPE" | "UNIT";
  /** PER_ROOM: one price per night. PER_OCCUPANCY: a price per adult count (1, 2, 3 ...). */
  pricingModel: "PER_ROOM" | "PER_OCCUPANCY";
  /** The vendor can include payment-card details in bookings. They are NEVER stored (see
   *  DECISIONS.md "Channel bookings never store card details"); parseBooking strips them. */
  sendsCardData: boolean;
};

export interface ChannelProvider {
  readonly id: string;              // stored in ChannelConnection.provider
  readonly displayName: string;     // every UI string uses this, never "Beds24"
  readonly capabilities: ProviderCapabilities;
  /** Drives the Connect form: which fields to ask for, labels, help text, secret or not. */
  readonly setupFields: SetupField[];
  readonly rateIdLabel: string;

  // Auth: one entry point regardless of scheme
  connect(input: Record<string, string>, ctx: ProviderContext): Promise<StoredCredentials>;
  getAuthHeader(creds: StoredCredentials, ctx: ProviderContext): Promise<{ header: string; refreshed?: StoredCredentials }>;
  credentialHealth?(creds: StoredCredentials): { expiresInDays: number | null; needsKeepAlive: boolean };
  toConnectionError(e: unknown): string;

  // Outbound
  buildPush(plan: ChannelAvailabilityPlan): ProviderPushPayload;   // may contain several requests
  push(payload: ProviderPushPayload, ctx: ProviderContext): Promise<PushOutcome>;
  checkPush?(ref: string, ctx: ProviderContext): Promise<PushCheck>; // required when DEFERRED
  isValidRateId(value: string): boolean;

  // Catalog (optional)
  fetchCatalog?(ctx: ProviderContext): Promise<{ roomTypes: ExtRoomType[]; ratePlans: ExtRatePlan[] }>;

  // Inbound
  fetchRecentBookings(since: Date, ctx: ProviderContext): Promise<unknown>;
  extractBookings(payload: unknown): unknown[];
  parseBooking(raw: unknown): ParsedBooking;     // ParsedBooking gains externalRatePlanId, kind, version
  isCancelledStatus(status: string | null): boolean;
  verifyWebhook?(headers: Headers, rawBody: string, secret: string): boolean; // SIGNATURE providers
  webhookPropertyId?(body: unknown): string | null; // partner-account routing
  /** Required when capabilities.bookingAck: confirm receipt AFTER the booking is stored. */
  acknowledgeBooking?(externalBookingId: string, ctx: ProviderContext): Promise<void>;

  // PULL providers (vendor calls us)
  /** Parse the vendor's ARI read request into a window + room types; the engine computes the plan. */
  parseAriRequest?(headers: Headers, rawBody: string): { externalPropertyId: string; from: Date; to: Date } | null;
  /** Render the engine's plan in the vendor's response format. */
  renderAriResponse?(plan: ChannelAvailabilityPlan): { contentType: string; body: string };
}

type PushOutcome =
  | { state: "CONFIRMED" }
  | { state: "PENDING"; ref: string }                    // DEFERRED providers
  | { state: "PARTIAL"; refused: RefusedValue[] };       // some cells rejected
```

`ProviderContext` carries the log sink, the connection id and the external property id, so a
partner-account provider can add its property header (ZimmerStack `X-ZS-Property`).

### Schema changes (one migration)

- `ChannelConnection`
  - `credentials String?`: encrypted JSON blob (`{ refreshToken, accessToken, expiresAt }` or
    `{ apiKey }`), owned by the provider. Migrate existing token columns into it, then drop
    them in a later migration (keep both for one release).
  - `webhookSecret String?` (encrypted) for SIGNATURE providers.
  - `accountId String?` → `ChannelProviderAccount` when the connection uses a platform account.
- **New `ChannelProviderAccount`**: `provider`, `name`, encrypted `credentials`, encrypted
  `webhookSecret`, rate-limit fields. Holds the Uppsolut ZimmerStack company key (and could
  later hold the Beds24 master account). `managedBy: "OSTA"` connections point at it.
- `ChannelRatePlanMap`: add nullable `roomTypeId`; unique becomes `(linkId, ratePlanId, roomTypeId)`.
  `PER_PLAN` providers leave it null (today's behaviour).
- **New `ChannelPushBatch`**: `connectionId`, `providerRef`, `state` (PENDING/LANDED/PARTIAL/FAILED),
  `refusedSummary`, `sentAt`, `checkedAt`. Lets the Hub show "Synced" only when it is.
- `ChannelInboundBooking`: add `kind` (`OTA` | `DIRECT`), `externalRatePlanId`, `externalVersion Int?`
  (ignore an older version arriving after a newer one), `cardSupplied Boolean @default(false)`.
- `rawPayload` is stored "never redacted" today (schema comment). Under the no-card-data rule it
  must pass through a provider `stripCardData(raw)` before storage. **Phase 0 check:** confirm
  whether Beds24 booking payloads already carry card fields; if they do, strip them and scrub
  existing rows in a migration.
- Replace every `refreshToken != null` check with `hasCredentials(connection)`.

### Engine changes

- **Push:** `push()` returns an outcome. DEFERRED results write a `ChannelPushBatch`; a new
  `channel-push-check` job (or the next push) calls `checkPush()` no more often than the vendor
  allows (ZimmerStack: 15 s), and marks the batch / connection health.
- **Restrictions:** extend `ChannelNight` with `minStay`, `maxStay`, `closedToArrival`,
  `closedToDeparture` only when the app holds those rules. Each provider sends what its
  `capabilities.restrictions` lists and ignores the rest (logged once).
- **Webhooks:** keep `/api/channels/webhook/[token]` (URL_TOKEN providers). Add
  `/api/channels/webhook/p/[providerId]` for SIGNATURE + partner-account providers: verify the
  signature with the account's secret, resolve the connection by `webhookPropertyId()`,
  dedupe on the event id, then the same `ingestBookings()`. Respond 2xx fast (ZimmerStack: ≤10 s),
  queue heavy work if needed.
- **Ingest:** remove the Beds24 parser default, `parse` becomes required. Direct bookings use
  the same pipeline with `kind = DIRECT`. When `externalRatePlanId` maps to one of our plans
  (and its meal plan), conversion uses it instead of the link's default rate plan.
- **Keep-alive job:** runs only for providers whose `credentialHealth` reports `needsKeepAlive`.
- **UI:** every "Beds24" string becomes `provider.displayName`. The Connect form renders
  `setupFields`. The mapping screen shows a picker from `fetchCatalog()` when available,
  otherwise free text validated by `isValidRateId`. Rate mapping shows one row per room type
  when `rateMapping = PER_PLAN_AND_ROOM_TYPE`. Rate-limit wording comes from the provider.
- **Licensing (owner, 2026-11-23):** a provider may declare `addonModule` (ZimmerStack:
  `"CHANNEL_ZIMMERSTACK"`). When set, the enterprise needs that `EnterpriseAddonAccess` row
  enabled (Osta switches it, same as Spa/Excursions/Transportation). Checked in ONE helper,
  `assertProviderLicensed(enterpriseId, provider)`, called at connect, push, poll and webhook
  ingest; the provider is hidden from pickers without it. Add-on off = connection kept but
  paused and shown as "blocked by licence". `assertChannelCapacity` caps still apply. A third
  vendor that is sold separately just declares its own `addonModule`.

## Phases

Each phase ships on its own branch, tests green, no behaviour change for Beds24 unless stated.

| Phase | Work | Done when |
|---|---|---|
| **0. Shared safety fixes** | Inbound `RECEIVED` bookings reduce pushed availability (in `sync.ts` only, not the shared `availability.ts` the desk uses); ingest triggers immediate push; safe auto-cancel vs flag, changes flagged with one-click Apply | Tests: a received-but-unconverted booking lowers the pushed count and nothing the desk sees changes; a safe cancellation cancels the reservation; each unsafe condition (checked in, folio posting, staff edit, linked add-on) flags instead; a date change is flagged, never applied |
| **1. Clean the seam** | Move shared types/errors to `core/`; Beds24 files into `providers/beds24/`; remove direct Beds24 imports from routes and `hub-overview.ts`; `hasCredentials()`; required `parse`; UI strings via `displayName`; drop the `"BEDS24"` schema default and `DEFAULT_PROVIDER_ID`; retired registry entries so `getProvider()` never throws for history | `grep -r "channels/beds24" src` hits only `providers/beds24/`; all existing tests pass unchanged |
| **2. Widen the interface + schema** | Capabilities, `connect`/`getAuthHeader`, `PushOutcome`, `credentials` blob, `ChannelProviderAccount`, `ChannelPushBatch`, per-room-type rate maps, inbound `kind`/`version`; Beds24 adapted to it | Beds24 sandbox/fixture tests pass; data migration keeps existing connections working |
| **3. Provider contract test suite + fake vendor + boundary test** | (a) One suite run against every registered provider with fixtures: payload never sends unpriced nights as 0, closed nights close, excluded room types absent, parse round-trips, cancellation words, webhook verify rejects tampered/old bodies, credentials never in logs, card fields never survive `parseBooking` or `rawPayload`. (b) `tests/channels/fake-provider.ts`: the awkward fake (principle 5), registered only in tests, run through push, poll, webhook, ack and PULL paths end to end. (c) Boundary test (principle 4). Engine gains the generic pieces the fake needs: ack after store, PULL ARI endpoint `/api/channels/ari/p/[providerId]`, per-unit and per-occupancy plan shapes | Beds24 and the fake both pass; boundary test green; suite is the gate for ZimmerStack |
| **4. ZimmerStack provider (sandbox)** | Client (Bearer key, `X-ZS-Property`, idempotency keys, pacing, `RateLimit` headers), payloads for availability/rates/restrictions with ranges + 1,000-update cap, batch check, catalog, OTA + direct webhooks (Standard Webhooks HMAC, 5-min window, dedupe on id, version order), poll fallback, `toConnectionError` for its error codes (`RATE_OUT_OF_BAND`, `SCOPE_MISSING`, ...) | Contract suite passes; end-to-end in ZimmerStack sandbox incl. simulated outage/throttle and a website booking arriving between two pushes |
| **5. Setup UI + partner account** | ZimmerStack add-on switch in the Osta console licence screen (next to Spa/Excursions); provider picker in the Osta console Connect (ZimmerStack shown only when the add-on is on); Osta console screen for the ZimmerStack company key and webhook secret; optional "add hotel to ZimmerStack" via `POST /properties`; go-live readiness check shown in Hub | A property can be connected to ZimmerStack from the UI without touching the DB |
| **6. Pilot** | The current test customer (or a sandbox clone of their setup) runs on ZimmerStack; daily cross-check of OTA extranets for 2 weeks | No missed or double bookings; refused values visible in Logs |

## Removing a vendor (Beds24 may be dropped entirely)

Owner, 2026-11-23: working with Beds24 has not been easy and it **may be removed completely**
later. So a vendor must be as easy to remove as to add, and Beds24 gets no new investment.

**Design rules that make removal cheap**

- **No vendor is the default.** Today `ChannelConnection.provider` defaults to `"BEDS24"` and
  `createConnection` falls back to `DEFAULT_PROVIDER_ID`. Phase 1 removes both: the provider is
  always chosen explicitly. Otherwise removing Beds24 silently changes what "no choice" means.
- **No vendor-named columns or tables.** Credentials move into the `credentials` blob (Phase 2);
  rate-limit fields stay generic. Nothing in the schema says Beds24 except stored data values.
- **History survives the vendor.** Sync logs and inbound bookings of a removed vendor must still
  display. The registry keeps a **retired entry** (`{ id, displayName, retired: true }`, no code
  behind it); `getProvider()` returns it for display and every action refuses with "This channel
  manager is no longer supported". Today `getProvider()` throws on an unknown id, which would
  break the Logs screen and the inbound bookings list the day Beds24 is deleted.
- **Vendor text lives with the vendor.** UI labels, help text and error wording come from the
  provider. The docs portal pages that name Beds24 (6 files under `src/app/docs`) become a page per
  vendor, so dropping one is dropping its page.
- **Beds24 work is maintenance only:** keep it working and safe (Phase 0 fixes, Phase 1 move,
  Phase 2 adapt to the new interface, the card-data check). No new Beds24 features, no Beds24
  certification or polish.

**Checklist: removing a vendor**

1. Move every connection on it to another vendor (or disconnect) and confirm none are live.
2. Replace its registry entry with a retired entry; delete `providers/<vendor>/` and its tests
   and fixtures.
3. Delete its docs page and its `addonModule` (if any).
4. The boundary test (principle 4) proves nothing else referenced it: if the build and tests
   pass, it is gone.

## Checklist: adding the third vendor later

0. Before any code, check the vendor against the capability list: sync direction (push or
   pull), booking ack, inventory and pricing model, card data, webhook auth, and whether it needs
   **certification** (SiteMinder, STAAH and most large vendors do; allow weeks to months). A
   difference the list does not cover means widening the interface first, in its own PR,
   proven with the fake vendor.
1. Create `providers/<vendor>/` implementing `ChannelProvider`; declare honest capabilities.
2. Add it to `PROVIDERS` in `registry.ts`.
3. Add fixtures and run the provider contract suite until it passes.
4. If `partnerAccount`, add its account in the Osta console. If `SIGNATURE`, set the webhook
   secret. Nothing else changes.
5. Pilot on one property before offering it.

## Open questions for the owner

1. ~~Maldives coverage~~: owner confirmed 2026-11-23 that ZimmerStack covers the Maldives OTAs.
   (Support/uptime terms still worth getting in writing before go-live.)
2. ~~Cancel vs flag~~: decided 2026-11-23 (see Phase 0 gap 2 and DECISIONS.md).
3. ~~Partner key vs client keys~~: decided 2026-11-23. Uppsolut's partner key only, Uppsolut
   bills the customer (DECISIONS.md "ZimmerStack runs on the Uppsolut partner account only").
   So Phase 5 builds only the Osta console path for ZimmerStack; no client-side connect form.
   The provider can still declare a hotel-key mode later without engine changes.
4. ~~Licence~~: decided 2026-11-23. ZimmerStack is an add-on enabled per enterprise by Osta
   (see Licensing above and DECISIONS.md).
5. ~~Test customer~~: 2026-11-23, was tied to Beds24 before but is not connected to any channel
   manager now, so the Phase 6 pilot connects them to ZimmerStack directly (no migration).
