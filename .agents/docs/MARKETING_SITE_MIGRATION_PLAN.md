# Marketing site migration — move `/info` from the PMS to `uppsolut.com`

**Status:** Not started. Ready to execute.
**Owner:** _(assign)_
**Written:** 2026-08-12
**Audience:** the engineer (and their coding agent) performing the migration.

---

## 1. What this is

Four marketing pages currently live **inside the PMS application** at
`https://stay.uppsolut.com/info`. That was always a temporary arrangement — the pages
were built there so the team could review them on a real URL without waiting for the
marketing domain.

This plan moves them to `https://uppsolut.com` and removes them from the PMS.

### Current routes (live in production today)

| URL | Page |
|---|---|
| `https://stay.uppsolut.com/info` | Uppsolut company overview |
| `https://stay.uppsolut.com/info/stay` | Uppsolut Stay — property management (Live product) |
| `https://stay.uppsolut.com/info/pos` | Uppsolut POS — retail (In development) |
| `https://stay.uppsolut.com/info/rent-manager` | Uppsolut Rent Manager (In development) |

### Target routes

| From | To |
|---|---|
| `stay.uppsolut.com/info` | `uppsolut.com/` |
| `stay.uppsolut.com/info/stay` | `uppsolut.com/stay` |
| `stay.uppsolut.com/info/pos` | `uppsolut.com/pos` |
| `stay.uppsolut.com/info/rent-manager` | `uppsolut.com/rent-manager` |

### Definition of done

1. All four pages serve from `uppsolut.com` and look identical to today.
2. `stay.uppsolut.com/info*` returns **301** redirects to the matching new URL.
3. `src/app/info/` is deleted from the `ostastay` repository.
4. `robots.txt` and `sitemap.xml` exist on the new domain and the site is submitted
   to Google Search Console.
5. The PMS itself is untouched and healthy.

---

## 2. Verified facts about the current state

Everything in this section was checked on 2026-08-12. **Re-verify before starting** —
some of it may have moved.

### 2.1 `uppsolut.com` is ALREADY SERVING A SITE

This is the single most important thing to know before you start. `uppsolut.com`
currently returns **HTTP 200** with:

```
<title>Uppsolut — Modern Software Solutions</title>
Server: cloudflare
CF-Cache-Status: HIT
```

It is serving an **older placeholder page** — a single static HTML file using the
Tailwind CDN and a sky-blue palette that predates the current brand work. Migrating
means **replacing** that page, not deploying into an empty domain.

> **Do not skip Phase 0.** Nobody currently on this task knows for certain where that
> file is hosted or who deploys it. Find out before you touch DNS.

### 2.2 DNS

| Host | Resolves | Notes |
|---|---|---|
| `uppsolut.com` | `104.21.58.94`, `172.67.158.194` (+IPv6) | Cloudflare proxied |
| `stay.uppsolut.com` | Same Cloudflare IPs | Cloudflare proxied → VPS origin |
| `www.uppsolut.com` | **NXDOMAIN** | No record exists at all |

If the business wants `www.uppsolut.com` to work, a DNS record must be **created** —
it does not exist today. Decide apex-vs-www in Phase 0 (§4.2).

### 2.3 The PMS production host

- VPS: `vps-9d96501a.vps.ovh.ca`, user `ubuntu`, app at `/home/ubuntu/ostastay`
- Deploy: push to `master` → GitHub Actions (`.github/workflows/deploy.yml`) → SSH →
  `git pull` + `docker compose build app` + `docker compose up -d app`
- Edge: a **shared Caddy proxy** at `deploy/proxy/`, owning ports 80/443 for every
  project on the host.
- **Caddy has a drop-in mechanism**: `import /etc/caddy/sites.d/*.caddy`. Each project
  adds ONE file to `deploy/proxy/sites.d/`. Nobody edits the main `Caddyfile`. See
  `deploy/proxy/sites.d/README.md`. This matters for both Phase 5 (option B) and
  Phase 6 (redirects).

### 2.4 The files being moved

All twelve files live under `src/app/info/` and are self-contained:

| File | Lines | What it is |
|---|---|---|
| `info.css` | 1184 | All styling. Role-based tokens, both themes. |
| `layout.tsx` | 108 | Shared chrome: nav, footer, theme resolution, `metadataBase` |
| `page.tsx` | 278 | Company overview |
| `stay/page.tsx` | 343 | Uppsolut Stay |
| `pos/page.tsx` | 84 | Uppsolut POS (uses shared template) |
| `rent-manager/page.tsx` | 84 | Rent Manager (uses shared template) |
| `product-page.tsx` | 243 | Shared body for in-development products |
| `products.ts` | 92 | **Single source** for names, marks, roles, status |
| `scroll-effects.tsx` | 160 | IntersectionObserver motion, no library |
| `theme-toggle.tsx` | 61 | Light/dark button |
| `theme.ts` | 23 | Cookie name + max-age constants |
| `nav.tsx` | 29 | Nav with active-page state |

**The only import that reaches outside this folder** is:

```ts
import { UppsolutIcon, UppsolutWordmark } from "@/components/brand/uppsolut-logo"
```

That is the entire coupling to the PMS. Everything else is internal.

---

## 3. Prerequisites

Collect these before starting. Missing access here is the most likely cause of a
half-finished migration.

- [ ] Push access to the `issey-dev/ostastay` GitHub repo
- [ ] Cloudflare dashboard access for the `uppsolut.com` zone (DNS + whatever hosts
      the current page)
- [ ] Wherever the **current** `uppsolut.com` page is deployed from (Phase 0 finds this)
- [ ] SSH to `ubuntu@vps-9d96501a.vps.ovh.ca` — only if you choose hosting option B,
      or for the Phase 6 redirect if done in Caddy
- [ ] Google Search Console access for `uppsolut.com` (or ability to verify it)
- [ ] Node 22 and Docker locally
- [ ] Decision on the questions in §4

---

## 4. Decisions to confirm BEFORE writing code

Do not start Phase 1 until these are answered. Each one changes the work.

### 4.1 Hosting model — **this is the big one**

The current pages are **server-rendered** (`force-dynamic`) and read a cookie on the
server to decide the colour theme. That design assumes a Node server. Two options:

#### Option A — Static export on Cloudflare Pages **(recommended)**

- A marketing site with no per-request data has no reason to run a server.
- Free, globally cached, no VPS load, no container to keep healthy.
- The domain is already on Cloudflare.
- **Requires two code changes** (§5.3): drop `force-dynamic`, and replace the
  server-cookie theme with a pre-paint inline script. Both are small but mandatory —
  see the warning in §5.3.2, it is the subtlest part of this migration.

#### Option B — Node server on the existing VPS

- Reuses the Caddy `sites.d` drop-in and the deploy pattern the team already knows.
- The cookie-based theme keeps working **unchanged**.
- Costs a second container on the box and another thing that can go down.

**Recommendation: Option A.** The rest of this plan is written for A, and flags
every place B differs.

### 4.2 Apex or `www`?

Pick ONE canonical host and 301 the other to it.

- `uppsolut.com` (apex) already resolves and serves. `www` does not exist.
- **Recommendation: apex.** Less work, already live, one fewer DNS record.
- If `www` is wanted anyway: add a CNAME `www → uppsolut.com` (proxied) and a
  redirect rule. Make sure `metadataBase` matches whichever you choose, or every
  canonical tag will point at the non-canonical host.

### 4.3 Same repo or a new one?

- **New repo (recommended):** `uppsolut-web`. The marketing site and the PMS have
  nothing in common, different release cadence, and the PMS deploy pipeline runs the
  full vitest suite — no reason for a copy tweak to wait on that.
- Same repo as a second app: only if the team strongly prefers a monorepo. Adds
  build complexity for no benefit here.

### 4.4 What happens to the old placeholder page?

The current `uppsolut.com` page is replaced. Confirm with the owner that nothing
links to it that matters, and **keep a copy** before deleting (Phase 0.3).

---

## 5. Execution

### Phase 0 — Discovery (do not skip)

**0.1 Find where the current `uppsolut.com` page is hosted.**

In the Cloudflare dashboard for the `uppsolut.com` zone, check in this order:

1. **Workers & Pages** — is there a Pages project bound to this domain? Most likely.
2. **DNS** — is the apex an `A`/`AAAA` to an origin server, or a `CNAME` to a Pages
   project? (Proxied records show the Cloudflare IPs either way, so the dashboard is
   the only reliable answer — `dig` will not tell you.)
3. **Rules → Redirect/Transform Rules** — anything already rewriting this host.
4. If it turns out to be an origin server, find it and note who deploys to it.

**0.2 Record what you found** in this document before continuing.

**0.3 Back up the existing page:**

```bash
curl -s https://uppsolut.com > uppsolut-com-placeholder-backup.html
```

Commit that to the new repo under `docs/` so it is recoverable.

**0.4 Confirm the PMS pages are healthy** (your rollback target):

```bash
for p in /info /info/stay /info/pos /info/rent-manager; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' https://stay.uppsolut.com$p)"
done
```

All four must return `200`.

---

### Phase 1 — Create the new project

```bash
npx create-next-app@latest uppsolut-web --ts --app --no-tailwind --no-src-dir --eslint
cd uppsolut-web
git init && git add -A && git commit -m "chore: scaffold"
```

Notes:
- `--no-tailwind` is deliberate — see §5.2.3, only seven utility classes are used and
  they are trivial to replace. If you would rather keep Tailwind, use `--tailwind` and
  skip §5.2.3.
- Match the Next major version the pages were written against (**Next 16**). They use
  the App Router, `metadataBase`, and route-segment config. Confirm with
  `npx next --version` after install.

---

### Phase 2 — Port the files

**2.1 Copy the page folder.** From the `ostastay` checkout:

```bash
cp -r src/app/info/* ../uppsolut-web/app/
```

This lands them at the domain root, which is exactly the target route shape:

```
app/
├── layout.tsx          ← becomes the ROOT layout (see 5.3.2)
├── page.tsx            → uppsolut.com/
├── info.css
├── products.ts
├── product-page.tsx
├── nav.tsx
├── theme.ts
├── theme-toggle.tsx
├── scroll-effects.tsx
├── stay/page.tsx       → uppsolut.com/stay
├── pos/page.tsx        → uppsolut.com/pos
└── rent-manager/page.tsx → uppsolut.com/rent-manager
```

**2.2 Copy the brand marks** — the one external dependency:

```bash
mkdir -p ../uppsolut-web/components/brand
cp src/components/brand/uppsolut-logo.tsx ../uppsolut-web/components/brand/
```

**2.3 Copy the brand reference material** (not shipped, but the next person will need it):

```bash
cp -r branding-guide ../uppsolut-web/docs/branding-guide
cp src/lib/brand.ts ../uppsolut-web/lib/brand.ts
```

---

### Phase 3 — Required code changes

These are **mandatory**. The pages will not work correctly without them.

#### 3.1 Fonts — `info.css` depends on two CSS variables

`info.css` references `var(--font-inter)` and `var(--font-jetbrains-mono)` throughout.
Those come from `next/font` in the PMS root layout. Recreate them in the new root
layout or **every heading falls back to Helvetica** and the brand type is lost:

```tsx
import { Inter, JetBrains_Mono } from "next/font/google"

// Inter must be the VARIABLE font (no `weight` option): the wordmark needs 900 and 300
// in the same string, and the headline weight-split depends on it.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" })

// ...
<body className={`${inter.variable} ${jetbrainsMono.variable}`}>
```

#### 3.2 The theme mechanism — **read this carefully**

> ⚠️ **This is the subtlest part of the migration.** Getting it wrong produces either a
> visible flash of the wrong theme on every load, or a toggle that silently forgets.

**Current design (in the PMS):** `app/info/layout.tsx` is a *nested* layout. It reads
a cookie **on the server** and renders `class="info-page info-light"` directly, so the
correct theme is in the first byte of HTML. It works, and it requires `force-dynamic`.

**Why it was built that way:** the obvious alternative — a synchronous inline
`<script>` that reads `localStorage` before paint — **does not work from a nested
layout**. React drops inline scripts rendered outside the root layout's `<head>`. This
was attempted during the original build; the script never reached the page and the
preference silently never persisted. Do not "simplify" it back into a nested layout
script and assume it works — verify it.

**What to do now:**

- **If Option B (Node server):** change nothing. It keeps working.
- **If Option A (static export):** server cookie reads are impossible. Switch to the
  inline-script approach — **which is now valid, because after Phase 2 this file is the
  ROOT layout**, and the root layout's `<head>` is exactly where inline scripts survive.
  The PMS itself does this in `src/app/layout.tsx`; copy that pattern.

  1. Delete `export const dynamic = "force-dynamic"` from `layout.tsx`.
  2. Delete the `cookies()` import and the cookie read.
  3. Add to the root layout's `<head>`:

     ```tsx
     const THEME_SCRIPT = `
     (function () {
       try {
         if (localStorage.getItem('uppsolut-info-theme') === 'light') {
           document.documentElement.classList.add('info-light');
         }
       } catch (e) {}
     })();
     `
     // ...
     <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
     ```
  4. In `info.css`, change the light selector from `.info-page.info-light` to
     `:root.info-light .info-page` (the class now lands on `<html>`, not the wrapper).
  5. In `theme-toggle.tsx`, replace the `document.cookie` write with
     `localStorage.setItem('uppsolut-info-theme', ...)` and toggle the class on
     `document.documentElement` instead of `.info-page`.
  6. `theme.ts` becomes the localStorage key constant; drop `INFO_THEME_MAX_AGE`.
  7. `layout.tsx` no longer passes `initialIsLight` — have the toggle seed its state in
     an effect from the `<html>` class instead.

  **Verify explicitly:** set light, hard-reload, and confirm there is no dark flash.
  Throttle the network in DevTools to make a flash visible if one exists.

#### 3.3 `metadataBase` — must not point at localhost

`layout.tsx` currently reads `process.env.APP_URL` at request time. A static build has
no request. Replace with a build-time constant:

```ts
export const metadata: Metadata = {
  metadataBase: new URL("https://uppsolut.com"), // or NEXT_PUBLIC_SITE_URL
}
```

> **Background:** this exact thing has already broken twice. The Docker build supplies
> no `APP_URL`, so an earlier static build shipped
> `<link rel="canonical" href="http://localhost:3000/info">` to production — telling
> Google the canonical URL was localhost. Then a later refactor dropped `metadataBase`
> entirely and canonicals went *relative*. **Verify the emitted tag** (§7) rather than
> trusting the code.

#### 3.4 Route + link rewrites

Every `/info` path must lose its prefix. Files and what to change:

| File | Change |
|---|---|
| `nav.tsx` | `` `/info/${p.slug}` `` → `` `/${p.slug}` `` |
| `layout.tsx` | `href="/info"` → `href="/"` (logo link + footer "Overview") |
| `layout.tsx` | footer `` `/info/${p.slug}` `` → `` `/${p.slug}` `` |
| `page.tsx` | `alternates.canonical: "/info"` → `"/"`; `openGraph.url` likewise |
| `page.tsx` | `href="/info/stay"` → `"/stay"` |
| `stay/page.tsx` | canonical `"/info/stay"` → `"/stay"`; `openGraph.url` likewise |
| `stay/page.tsx` | `` `/info/${p.slug}` `` in the platform strip → `` `/${p.slug}` `` |
| `pos/page.tsx` | canonical `"/info/pos"` → `"/pos"`; `openGraph.url` likewise |
| `rent-manager/page.tsx` | canonical `"/info/rent-manager"` → `"/rent-manager"`; ditto |
| `product-page.tsx` | `href="/info/stay"`, `href="/info"`, `` `/info/${p.slug}` `` → root-relative |
| `page.tsx` | `href="/info#contact"` → `"#contact"` |

Sanity check when done — this must return nothing:

```bash
grep -rn '"/info' app/
```

#### 3.5 Cross-domain links to the PMS

`href="/login"` currently resolves inside the PMS. On the marketing domain it 404s.
Every one must become absolute:

```
/login  →  https://stay.uppsolut.com/login
```

Occurrences: `layout.tsx` (header "Sign in"), `stay/page.tsx` (hero "Sign in to your
property"), `page.tsx` (contact row "Existing customer"). Verify:

```bash
grep -rn 'href="/login"' app/    # must return nothing
```

#### 3.6 Tailwind — only seven classes

`layout.tsx` and `uppsolut-logo.tsx` use a handful of Tailwind utilities:

```
h-8 w-8 shrink-0 · flex flex-col leading-none · h-[13px] w-auto · mt-1.5 · inline-flex items-center gap-2
```

Since the project was scaffolded `--no-tailwind`, replace them with CSS in `info.css`:

```css
.info-top-mark svg:first-child { height: 32px; width: 32px; flex: none; }
.info-mark-stack { display: flex; flex-direction: column; line-height: 1; }
.info-mark-stack > svg { height: 13px; width: auto; }
.info-mark-sub { margin-top: 6px; }
```

Then in `uppsolut-logo.tsx`, remove `import { cn } from "@/lib/utils"` and its uses —
`cn` only merges Tailwind classes and is pointless without it. Take `className`
straight through. (Doing this also drops the `clsx` and `tailwind-merge` dependencies.)

*If you kept Tailwind instead, skip this section entirely.*

#### 3.7 Static export config (Option A only)

```ts
// next.config.ts
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true }, // next/image cannot optimise without a server
}
```

Then confirm no page uses a dynamic API. `next build` fails loudly if one does — that
failure is the check.

#### 3.8 Security headers

Copy the `securityHeaders` array from the PMS `next.config.ts` as a starting point,
with two adjustments:

- `script-src` must keep `'unsafe-inline'` if you used the Phase 3.2 inline script.
- `img-src https:` can be tightened to `'self' data:` — the marketing site has no
  tenant-supplied images.

> **Static export note:** `output: "export"` **ignores** `headers()` in `next.config.ts`.
> On Cloudflare Pages set them in a `public/_headers` file instead. This is a silent
> failure — the config looks right and no header ships. Verify with
> `curl -I https://uppsolut.com`.

---

### Phase 4 — SEO (do this now, not later)

The whole reason for the domain move is that the marketing content should rank on the
brand's real domain.

**4.1 `app/robots.ts`**

```ts
import type { MetadataRoute } from "next"
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://uppsolut.com/sitemap.xml",
  }
}
```

> Check this actually serves. Cloudflare currently returns a **managed `robots.txt`**
> for these hostnames (verified on `stay.uppsolut.com`). If Cloudflare's copy wins,
> disable the managed robots feature in the dashboard for this zone.

**4.2 `app/sitemap.ts`** — list all four URLs.

**4.3 Open Graph image.** There is none today, so link previews are bare text. Add
`app/opengraph-image.tsx` (Next renders it at build). 1200×630, Obsidian `#0D0F11`
background, the wordmark, and the page title.

**4.4 Google Search Console**

1. Add `uppsolut.com` as a property, verify (DNS TXT via Cloudflare is easiest).
2. Submit `https://uppsolut.com/sitemap.xml`.
3. Use **URL Inspection → Request Indexing** on all four URLs.
4. Indexing takes days to weeks. It will not be instant.

**4.5 `robots` metadata.** The pages currently ship `index: true, follow: true` — keep
that on the new domain. If you want to keep them out of the index until launch, flip to
`noindex` and **set a reminder to remove it**, because a forgotten `noindex` is the
classic reason a new site never ranks.

---

### Phase 5 — Deploy the new site

#### Option A — Cloudflare Pages

1. Push `uppsolut-web` to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build command `npm run build`, output directory `out`.
4. Deploy and check the generated `*.pages.dev` URL **before touching DNS**.
5. **Custom domain:** add `uppsolut.com`.
   - If a Pages project already serves the apex (Phase 0.1), remove the binding from
     the old project first — two projects cannot claim the same hostname.
   - If the apex points at an origin server, change the DNS record to the Pages
     project. **Lower the record TTL to 60s a day beforehand** so a rollback is fast.
6. Add `www.uppsolut.com` too, if §4.2 said so, redirecting to the apex.

#### Option B — VPS + Caddy

1. Give the project its own `docker-compose.yml`, on the shared `edge` network, **with
   no `ports:`** — per `deploy/proxy/sites.d/README.md`.
2. Add `deploy/proxy/sites.d/uppsolut-web.caddy`:

   ```caddy
   uppsolut.com {
       import security_headers
       reverse_proxy uppsolut-web:3000
   }
   ```
3. `cd ~/ostastay/deploy/proxy && docker compose up -d --build`
4. Point the `uppsolut.com` DNS at the VPS. Caddy provisions the certificate itself.

---

### Phase 6 — Redirect the old URLs (do NOT skip)

Anything already linking to `stay.uppsolut.com/info` must survive, and search engines
need to be told the content moved. **301 (permanent)**, not 302.

**Preferred: Caddy**, because it works even when the app container is down and keeps
marketing routing out of the product codebase. Edit the `stay.uppsolut.com` block in
`deploy/proxy/Caddyfile`:

```caddy
redir /info https://uppsolut.com/ 301
redir /info/stay https://uppsolut.com/stay 301
redir /info/pos https://uppsolut.com/pos 301
redir /info/rent-manager https://uppsolut.com/rent-manager 301
redir /info/* https://uppsolut.com/ 301
```

Place these **before** the `reverse_proxy` directive. Reload:

```bash
cd ~/ostastay/deploy/proxy && docker compose up -d --build
```

**Alternative: Next.js** — add a `redirects()` block to the PMS `next.config.ts`. Works,
but couples marketing routing to the product deploy.

**Keep the redirects for at least 12 months.** Removing them early strands any external
link and discards the ranking signal being passed to the new domain.

---

### Phase 7 — Remove the pages from the PMS

**Only after Phases 5 and 6 are verified in production.**

```bash
cd ostastay
git checkout -b chore/remove-marketing-pages
git rm -r src/app/info
```

Then:

- [ ] Confirm nothing else imports from `src/app/info` (nothing should):
      `grep -rn "app/info" src/ --exclude-dir=node_modules`
- [ ] **Keep** `src/components/brand/uppsolut-logo.tsx` — the PMS uses it in its own
      sidebar and login page. It was *copied*, not moved.
- [ ] Keep the Phase 6 redirects.
- [ ] Open a PR. The pipeline runs `tsc`, `eslint` and the full vitest suite; all must pass.
- [ ] **Team workflow: open the PR and stop.** Do not merge without the owner's word.
      Note also that merging squashes only what is on the branch *at merge time* — if
      you are still pushing when it is merged, later commits are silently dropped.
      (This already happened once during the original build, which is why PR #46 exists.)

After merge, confirm the PMS is unaffected:

```bash
for p in / /login /e/veyo/dashboard; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' -L https://stay.uppsolut.com$p)"
done
```

---

## 6. Rollback

| Failure | Recovery |
|---|---|
| New site broken after DNS cutover | Repoint DNS to the previous target. Keep TTL at 60s during the change so this takes a minute, not hours. |
| New site wrong but DNS fine | Cloudflare Pages keeps every deployment — roll back to the prior one in the dashboard. |
| Redirects wrong | Revert the `Caddyfile` change and `docker compose up -d --build` in `deploy/proxy`. |
| Pages deleted from PMS too early | `git revert` the removal PR; the deploy pipeline restores `/info`. |

The PMS is never at risk in Phases 0–6 — nothing in them touches the product. The only
change to the PMS repo is Phase 7.

---

## 7. Verification checklist

Run **all** of it against production before calling this done.

### 7.1 Routes

```bash
for p in / /stay /pos /rent-manager; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' https://uppsolut.com$p)"
done
```
All `200`.

### 7.2 Canonicals — must be absolute and on the new domain

```bash
for p in / /stay /pos /rent-manager; do
  echo "$p"; curl -s https://uppsolut.com$p | grep -o 'rel="canonical" href="[^"]*"'
done
```

Expect `https://uppsolut.com/...`. **Fail if** you see `localhost`, a relative
`href="/stay"`, or `stay.uppsolut.com`. (All three have occurred before.)

### 7.3 Redirects from the old domain

```bash
for p in /info /info/stay /info/pos /info/rent-manager; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://stay.uppsolut.com$p)"
done
```
Each must be `301` to the matching new URL.

### 7.4 Content is in the server HTML (what a crawler sees)

```bash
curl -s https://uppsolut.com/ | grep -c "Absolute control"     # 1
curl -s https://uppsolut.com/stay | grep -c "One system"        # 1
curl -s https://uppsolut.com/pos | grep -c "Sell fast"          # 1
```

> The reveal animations hide sections until scrolled — but **only once JS confirms it
> can run**, and there is a 2.6s failsafe. If a change ever makes content
> hidden-by-default in the HTML, the page becomes invisible to crawlers. That is the
> single most damaging thing that can go wrong on a page whose purpose is to be indexed.

### 7.5 Manual browser checks

- [ ] Theme toggle works; **hard-reload shows no flash** of the wrong theme
- [ ] Preference survives navigating between all four pages
- [ ] Nav highlights the current page
- [ ] Hero CTA visible without scrolling on a 1440×900 laptop
- [ ] No horizontal scrollbar at 1440px **or** 390px
- [ ] Browser console clean (a blocked `cloudflareinsights` beacon is pre-existing and
      expected — it is the CSP doing its job)
- [ ] `prefers-reduced-motion: reduce` — content visible, no animation
- [ ] **JavaScript disabled — every section still visible**
- [ ] "Sign in" reaches `https://stay.uppsolut.com/login`
- [ ] Footer year is current

### 7.6 SEO

- [ ] `https://uppsolut.com/robots.txt` is yours, not Cloudflare's managed one
- [ ] `https://uppsolut.com/sitemap.xml` lists four URLs
- [ ] Search Console property verified, sitemap submitted, indexing requested
- [ ] Share a link in Slack/WhatsApp and confirm the preview renders

### 7.7 PMS unaffected

- [ ] `/`, `/login`, dashboard all still `200`
- [ ] `docker compose ps` shows `healthy`
- [ ] `docker compose logs app --since 15m | grep -iE '⨯|error'` is quiet

---

## 8. Known traps

Every one of these has already bitten someone on this work.

1. **`metadataBase` silently degrading.** No `APP_URL` at build → `localhost` in the
   canonical. Removing it → *relative* canonicals. Both shipped to production once.
   Always verify the emitted tag, never the code.

2. **Inline scripts vanish from nested layouts.** React only keeps them in the *root*
   layout's `<head>`. The theme was built server-side precisely because of this. After
   the move the file *is* the root layout, so the script approach becomes valid — but
   test it, do not assume.

3. **A `"use client"` module's exports are proxies on the server.** Importing a plain
   constant or function from one into a server component gives a client-reference proxy,
   not the value. With a function it throws (this took `/osta` down — PR #42). With a
   string it fails *silently* — the theme cookie name lived in the client toggle and
   `cookies().get()` simply always missed. Keep shared constants in a neutral module.

4. **Static export ignores `headers()`.** Use `public/_headers` on Cloudflare Pages.
   Silent failure; verify with `curl -I`.

5. **Cloudflare's managed `robots.txt`** can override yours.

6. **Reveal animations vs. crawlers.** See §7.4.

7. **Squash-merge drops in-flight commits.** Check the PR's file list before merging.

8. **`www` does not exist.** It is NXDOMAIN today. If marketing hands out a `www` URL
   before the record exists, it is simply dead.

---

## 9. Open items for the owner

Not blocking the migration, but unresolved:

- **Product naming.** `branding-guide` §06 defines the sub-brands as **PAY** and
  **RENT**; the go-to-market names are **POS** and **Rent Manager**. `products.ts`
  carries both (`mark` vs `name`) — prose uses the go-to-market name, the nav uses the
  guide's mark. This divergence should be settled deliberately.

- **Imagery.** The pages are entirely typographic. Abstract per-product artwork was
  specified but not produced; slots are designed for it. Transparent PNGs with
  light-grey linework work in both themes from a single asset.

- **Contact form.** Currently a `mailto:`. The supplied sample had a form that called
  `alert()` and sent nothing, which was deliberately not carried over. A real form needs
  a backend — `src/lib/mailer.ts` in the PMS is the existing platform mailer.

- **Product status.** POS and Rent Manager are marked "In development" (confirmed by
  the owner, 2026-08-10). Update `products.ts` when that changes — one field, and the
  nav, cards and platform strips all follow.
