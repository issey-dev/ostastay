# Security audit — OstaStay (guest-house-pms) v5.7.0

Full-application security diagnostic across dependency/supply chain, Next.js-specific
static review, secrets, auth/session, multi-tenant isolation, and infra config.

- **Branch:** `security-audit-fixes` (branched from `master` @ `1ef993e`)
- **Scope:** 225 route handlers, 0 Server Actions, `src/proxy.ts`, Prisma data layer,
  Docker/deploy config, full git history (308 commits)
- **Build after fixes:** `npm run build` passes
- **Not done, per instructions:** nothing pushed to any remote

## Headline

The application's authorization architecture is sound and was not the source of any
finding. Every one of the 225 route handlers reaches `requireSession()` — the 12 that do
not were each verified as deliberately public and independently guarded (`NODE_ENV`
gate, constant-time cron secret, 256-bit hashed bearer token, or an unconditional 403).
Tenant scoping is enforced at the data-access layer via `assertPropertyAccess()` /
`assertProfileAccess()`, and no IDOR was found: `enterpriseId` is never accepted from
client input except on Osta-internal routes that gate on `ctx.isInternal` first.

The real findings were at the **edges** — HTTP response headers, the dependency tree,
and an unused-but-live framework endpoint — not in the application's own logic.

## Findings

| ID | Severity | Location (file:line) | Description | Exploit scenario | Status | Fix commit |
|----|----------|----------------------|-------------|------------------|--------|------------|
| FND-001 | Medium | `next.config.ts:1` (pre-fix) | No security headers emitted at all — no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy. | The dashboard could be framed by any origin and clickjacked into state-changing clicks (folio postings, refunds, user-role edits) using the victim's live `auth_token`. Absent `nosniff`, the guest ID-photo download route — which streams a guest-uploaded file with a stored `Content-Type` — becomes a MIME-confusion vector. Absent HSTS, a first-visit downgrade exposes the session cookie. | **Fixed** | `5bf855d` |
| FND-002 | High | `package.json:32` | Next.js pinned to `16.2.10`, which carries a published middleware/proxy authorization-bypass advisory (GHSA-6gpp-xcg3-4w24) plus two response-cache-confusion advisories, a Server Actions DoS, and an unauthenticated internal-endpoint disclosure. | This app gates `/dashboard` and `/e/{slug}/dashboard` in `src/proxy.ts`; the bypass advisory targets exactly that layer. Cache confusion could serve one tenant's response body to another tenant's request — a cross-tenant leak reachable without any application bug. | **Fixed** | `5921872` |
| FND-003 | Medium | `package.json:39` (pre-fix) | `shadcn` — a scaffolding CLI, never imported by any source file — was in `dependencies` rather than `devDependencies`, dragging `undici` and `@dotenvx/dotenvx` into the production tree. It was the sole source of both high-severity `undici` advisories (GHSA-8xcm-r25x-g524 response desync, GHSA-4cwx-7wf7-3272 cross-user cache disclosure). | Ships a dev-time CLI and its vulnerable HTTP stack into the production image, widening the runtime attack surface with code that has no reason to be there. Removing it eliminated 4 of 10 audit findings outright. | **Fixed** | `5921872` |
| FND-004 | Medium | `next.config.ts:1` (pre-fix) | The `/_next/image` optimization endpoint was enabled and publicly reachable, but **nothing in the app imports `next/image`** — every logo and photo is a plain `<img>`. It is the host for the `sharp`/libvips CVEs (GHSA-f88m-g3jw-g9cj), the SVG-decode DoS (GHSA-q8wf-6r8g-63ch), and the classic remote-pattern SSRF. | An unauthenticated attacker could drive image decoding through `sharp`/libvips for DoS, with zero legitimate callers to disrupt. Now returns 404 (verified). | **Fixed** | `5bf855d` |
| FND-005 | Low | `src/app/api/licenses/enterprise-addons/route.ts:47` | `PATCH` wrote `body.module` directly into `EnterpriseAddonAccess`'s compound key with no allowlist check. | An Osta operator (or a compromised internal account) sends `module: "ANYTHING"`, creating a permanent row for a module that does not exist. The `GET` projects over `MODULES`, so the row is invisible in the UI and cannot be removed through it. Data integrity, not privilege escalation — the route is already `isInternal`-gated. | **Fixed** | `651775b` |
| FND-006 | Medium | `src/lib/secret-crypto.ts:35` | Encryption-at-rest for tenant secrets (SMTP/SFTP passwords) **fails open**: with `SECRETS_ENCRYPTION_KEY` unset, `encryptSecret()` silently returns plaintext and stores it. Contrast `src/lib/jwt-secret.ts:11`, which refuses to boot in production without its key. | An operator who deploys without setting the variable gets no error, no warning, and no indication in the UI — tenant mail-server credentials sit in the database in cleartext, exposed to any DB dump, backup, or support query. The inconsistency with `JWT_SECRET`'s fail-closed behavior makes it easy to assume this is handled. | **Open — needs human decision** | — |
| FND-007 | Low | `src/app/api/eregistration/[token]/slots/[slotId]/photo/route.ts:38` | Replacing an ID photo writes a new UUID-named file and repoints the DB, but never unlinks the previous file. Orphans accumulate on the `/app/storage` volume with no reaper. | A guest holding a valid link re-uploads a 10MB photo repeatedly; each attempt permanently consumes disk. Unbounded growth on the same volume the app needs to keep operating — degradation rather than direct compromise, and it needs a valid token. | **Open — needs human decision** | — |
| FND-008 | Low | `src/app/api/eregistration/[token]/slots/[slotId]/photo/route.ts:9` | The public eRegistration write endpoints (draft PATCH, photo POST, finalize) have no rate limiting. The login path has one (`src/lib/login-rate-limit.ts`); these do not. | Token brute-force is infeasible (256-bit, hashed at rest), so this is not an access-control gap — it is an amplification one. A single leaked or shared link permits unbounded 10MB uploads, compounding FND-007. | **Open — needs human decision** | — |
| FND-009 | Medium | `next.config.ts:20` | The CSP added in FND-001 still carries `script-src 'unsafe-inline'`, because the theme-init script (`src/app/layout.tsx:46`) and Next's own bootstrap payloads are inline. | `unsafe-inline` means the CSP provides no meaningful XSS mitigation for script injection — it defends framing, form-action, base-uri, and object-src, but not injected `<script>`. No injection sink was found to pair this with (see "Verified clean"), so this is defense-in-depth that is currently incomplete, not a live hole. Closing it means threading a per-request nonce through the layout and Next's bootstrap. | **Open — needs human decision** | — |
| FND-010 | Informational | `src/proxy.ts:16` | The comment documenting where the enterprise-slug boundary is enforced named `src/app/e/[slug]/layout.tsx` — **a file that does not exist**. The check actually lives in `dashboard/layout.tsx:54` and `hub/layout.tsx:57`, deliberately split so the public `/e/[slug]/login` page renders without a session. | No runtime impact. Logged because it cost real time during this audit and would lead the next reviewer to conclude the boundary is missing. A comment naming a non-existent security control is a defect in its own right. | **Fixed** | `651775b` |
| FND-011 | Low | `node_modules/exceljs → uuid@8.3.2` | `uuid` advisory GHSA-w5hq-g745-h8pq: missing buffer bounds check in v3/v5/v6 **when `buf` is provided**. | Not reachable. `exceljs` (used only in `src/lib/reports/render/xlsx.ts`) never passes a `buf` argument, and the vulnerable v3/v5/v6 code paths are not invoked. The only available fix is `exceljs@3.4.0`, a major downgrade that would break XLSX report rendering — a real regression traded for a non-exploitable advisory. | **Won't fix** (not reachable; fix is a breaking downgrade) | — |
| FND-012 | Low | `src/lib/login-rate-limit.ts:14` | The login throttle is an in-process `Map`, so counters are per-instance and reset on restart. | Under a multi-instance deployment the effective limit multiplies by instance count, and an attacker who can trigger restarts clears lockouts. Currently correct: the deployment is explicitly single-node (same assumption SQLite and the local upload storage already make), and the file documents this as the one seam to swap. Re-open if the app is ever horizontally scaled. | **Won't fix** (matches documented single-node deployment) | — |
| FND-013 | Low | `src/app/api/tenant-settings/route.ts:12`, `src/app/api/folios/route.ts:25`, `src/app/api/licenses/route.ts:14` | Three `GET` handlers write to the database. Under `SameSite=Lax`, top-level GET navigations do carry the session cookie, so these are cross-site reachable. | All three are idempotent get-or-create lazy initialization: they create a default row that the user's own first visit would create anyway. Forcing one early changes no state the victim did not already implicitly consent to, and no attacker-controlled values enter the row. No fix worth the diff; recorded so the pattern is not mistaken for a missed CSRF gap on re-review. | **Won't fix** (no attacker-controllable state change) | — |

## Verified clean

Checked and found sound — recorded so a future audit need not re-derive them:

- **Authorization on every route.** All 225 handlers reach `requireSession()`. The 12
  exceptions are each deliberate and independently guarded: `/api/auth/seed` 404s when
  `NODE_ENV=production`; `/api/jobs/run` uses a constant-time hashed comparison that
  fails *closed* when `CRON_SECRET` is unset (verified: returns 503); the four
  `/api/eregistration/**` routes are bearer-token scoped; two `/api/hub/connections/[id]`
  routes return an unconditional 403; login/logout/change-password are the auth surface
  itself; `/support-access/exit` only drops privilege.
- **No IDOR / cross-tenant access.** Every `[id]` route that mutates scopes its lookup by
  `enterpriseId` or an `assert*Access()` helper. The eRegistration slot routes — the one
  place a public caller supplies a record id — constrain it correctly with
  `findFirst({ where: { id: slotId, reservationId: { in: reservationIds } } })`, where
  `reservationIds` derives from the resolved token, never from client input.
- **All 13 `/api/osta/**` routes gate on `ctx.isInternal`.** Every route accepting a
  client-supplied `enterpriseId` checks internal status *before* using it.
- **No SQL injection.** Every `$queryRawUnsafe` call in `src/lib/db-health.ts` is a
  constant string with no interpolation.
- **No XSS sink.** Both `dangerouslySetInnerHTML` uses (`layout.tsx:46`,
  `print-document-shell.tsx:50`) render module-level constants; no user data reaches them.
- **File upload hardening is strong.** `src/lib/eregistration/storage.ts` sniffs magic
  bytes (never trusting `File.type`), rejects anything that isn't JPEG/PNG/WEBP/HEIC — so
  no SVG or HTML can be stored and re-served — generates its own filenames, caps at 10MB,
  and rejects any path that changes under `basename()`.
- **Session and cookie handling.** `auth_token` is `httpOnly`, `secure` in production,
  `SameSite=Lax`, 24h. The JWT carries identity only; role, `enterpriseId`, and active
  status are re-fetched live on every request, so a role change or account disable takes
  effect on the next click rather than the next login.
- **Password handling.** bcrypt cost 10; login returns one generic error for wrong
  email / wrong password / wrong enterprise code; the license check runs *after* the
  password check specifically so it cannot become an enumeration oracle; a temporary
  password never mints a session.
- **eRegistration tokens.** 256-bit, SHA-256 hashed at rest, generic error on every
  rejection path so validity cannot be probed.
- **No open redirects, no CORS headers, no SSRF.** No `returnTo`/`callbackUrl` parameter
  exists; every `redirect()` target is a server-derived literal; the only outbound
  `fetch()` calls use a constant `BEDS24_API_BASE`.
- **Secrets and git history.** No `.env` file is tracked (only `.env.example`, which
  contains `change_me` placeholders). No `NEXT_PUBLIC_` variable exists anywhere. A scan
  across all 308 commits surfaced only placeholders, deliberate test fixtures, and
  documentation examples. `test.db` is untracked and gitignored.
- **Docker.** The build-stage `ENV JWT_SECRET="placeholder..."` does **not** reach the
  runtime image — the runner is a separate `FROM base` stage, so `jwt-secret.ts`'s
  fail-closed production check is intact. Runtime runs as non-root (`uid 1001`).
- **The dev seed button** on the login page is gated server-side on
  `process.env.NODE_ENV !== "production"` (`src/app/login/page.tsx:4`).

## Dependency audit

`npm audit --omit=dev`: **10 findings (6 high, 4 moderate) → 5 (3 high, 2 moderate)**.

| Package | Resolution |
|---|---|
| `undici` ×2 high | Removed from the production tree entirely (FND-003) |
| `next` (9 advisories) | Patched 16.2.10 → 16.2.12 (FND-002) |
| `postcss` high | Resolved by the Next patch |
| `brace-expansion` high | Resolved via `npm audit fix` |
| `sharp` high | Attack surface removed by disabling the image optimizer (FND-004). Remains in the tree as an unreachable transitive dep of `next`; the only "fix" npm offers is `next@9.3.3`. |
| `uuid` moderate | Not reachable — see FND-011 |

## Verification performed

Against a live dev server, not inferred from the diff:

- Security headers present on the response, with `unsafe-eval`/`ws:` correctly scoped to
  dev and HSTS correctly absent outside production.
- Login page renders with zero console errors and no CSP violations; stylesheets load and
  the inline theme script still executes under the new policy.
- `GET /_next/image?url=...` → **404** (optimizer disabled).
- `GET /api/reservations` unauthenticated → **401**.
- `GET /api/licenses` unauthenticated → **401**.
- `POST /api/jobs/run` with no secret → **503** (fails closed).
- `npm run build` passes.

## Needs your decision

1. **FND-006 — should `SECRETS_ENCRYPTION_KEY` fail closed in production?** Making it
   throw at boot the way `JWT_SECRET` does is a two-line change, but it would **stop a
   currently-running production deployment from booting** if the variable isn't already
   set. That is a production-breaking change, so I did not make it. A middle option is a
   loud startup warning plus a Controls banner when the key is missing. Either way,
   existing plaintext rows need a re-encryption pass, since `encryptSecret()` only acts
   on write.
2. **FND-009 — invest in a CSP nonce?** Removing `script-src 'unsafe-inline'` requires
   threading a per-request nonce through `layout.tsx` and Next's bootstrap. Worth doing
   if you want the CSP to be real XSS defense; low urgency given no injection sink exists
   today.
3. **FND-007 / FND-008 — bound the eRegistration upload path?** Deleting the superseded
   photo on replace is a small, safe change I can make on request. A rate limit on the
   public write endpoints is a slightly larger one. I left both alone because they touch
   the live guest-facing flow, which felt worth asking about first.
