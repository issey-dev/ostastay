import type { Metadata } from "next"
import Link from "next/link"
import { UppsolutIcon, UppsolutWordmark } from "@/components/brand/uppsolut-logo"
import { PRODUCT_NAME } from "@/lib/brand"
import { InfoScrollEffects } from "./scroll-effects"
import "./info.css"

/**
 * The public marketing page for Uppsolut Stay.
 *
 * MOCKUP, PENDING RELOCATION. This lives at /info inside the application only so the
 * team can review it on a real URL; the intended home is the marketing domain. Nothing
 * here imports app state, session, or Prisma — it is deliberately a leaf with no
 * dependency on the product's internals, so moving the three files in this folder to
 * another Next app is a copy, not a rewrite.
 *
 * WHY IT IS A SERVER COMPONENT WITH NO DATA. Its entire purpose is to be crawled and
 * ranked, so every word must be in the initial HTML. The only client code is
 * InfoScrollEffects, which enhances motion and renders nothing. See info.css on why the
 * reveal animations cannot hide content from a crawler.
 *
 * COPY RULES. Voice is the brand guide's §09: short, declarative, verbs that move, no
 * hype. DESIGN_PLAN §0.2 additionally bans "Elevate", "Seamless", "Unleash", "Next-Gen"
 * and "Revolutionize" from product copy — that ban is honoured here too. Every claim
 * below is checkable against the shipped app; nothing is aspirational, and there are no
 * invented customer logos, testimonials or metrics.
 */

const SITE_DESCRIPTION =
  "Uppsolut Stay is a property management system for guesthouses, hotels and resorts — reservations, front desk, housekeeping, revenue, night audit and channel distribution in one operational system."

/**
 * Absolute base for canonical and og: URLs.
 *
 * Without a metadataBase Next emits `<link rel="canonical" href="/info">`, and a relative
 * canonical is close to useless — the whole point of the tag is to name ONE absolute URL
 * when the same page is reachable by several, which is exactly the situation this page is
 * heading into when it moves to the marketing domain. APP_URL is the variable the rest of
 * the app already builds public links from (see src/lib/email-templates.ts), so this
 * follows automatically once that is set per environment.
 */
const SITE_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "")

/**
 * Render per request rather than at build time.
 *
 * This page has no dynamic data, so Next would otherwise prerender it — and the Docker
 * build (see Dockerfile) deliberately supplies only JWT_SECRET and DATABASE_URL, never
 * APP_URL. Prerendering therefore froze SITE_URL at its localhost fallback and shipped
 * `<link rel="canonical" href="http://localhost:3000/info">` to production, which points
 * search engines at a host that does not exist — the exact opposite of what this page is
 * for. Verified by inspecting .next/server/app/info.html from a build with APP_URL unset.
 *
 * Rendering dynamically resolves APP_URL from the runtime environment instead (compose
 * passes it in via env_file), and also keeps the footer's copyright year honest rather
 * than fixing it to whenever the image happened to be built. The page is static markup,
 * so the per-request cost is negligible. When this moves to the marketing domain, the
 * better answer is a build-time constant for the canonical host and static rendering.
 */
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Property management for guesthouses, hotels and resorts",
  description: SITE_DESCRIPTION,
  keywords: [
    "property management system",
    "PMS",
    "hotel software",
    "guesthouse management",
    "resort management",
    "channel manager",
    "night audit",
    "Uppsolut",
    "Uppsolut Stay",
    "Maldives PMS",
  ],
  alternates: { canonical: "/info" },
  openGraph: {
    type: "website",
    url: "/info",
    title: `${PRODUCT_NAME} — property management for guesthouses, hotels and resorts`,
    description: SITE_DESCRIPTION,
    siteName: PRODUCT_NAME,
  },
  twitter: {
    card: "summary_large_image",
    title: `${PRODUCT_NAME} — property management, end to end`,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
}

/** The day, in the order a property actually runs it — mirrors NAV_GROUPS. */
const STAGES = [
  {
    k: "Operations",
    title: "Sell the room, then fill it.",
    body:
      "Reservations, group blocks and a tape chart that shows the whole property at once. Availability is calculated against real inventory — holds, stop-sales and out-of-order rooms included — so the number on the screen is the number you can sell.",
    chips: ["Front Desk", "Reservations", "Tape Chart", "Availability", "Group Blocks"],
  },
  {
    k: "Services",
    title: "Everything that happens around the room.",
    body:
      "Housekeeping task sheets, maintenance jobs, and fast posting from outlets straight to the guest folio. Spa and excursion booking run as licensed add-ons for properties that sell them.",
    chips: ["Housekeeping", "Maintenance", "Fast Post", "Spa", "Excursions"],
  },
  {
    k: "Finance",
    title: "Price it, collect it, close it.",
    body:
      "Rate plans and per-person allocations feed the folio. Cashiering handles shifts and settlement, debtors carries the city ledger, and night audit rolls the business date once — posting room and tax, then locking the day behind it.",
    chips: ["Revenue", "Cashiering", "Debtors", "Night Audit"],
  },
  {
    k: "Distribution",
    title: "One inventory, every channel.",
    body:
      "The Hub pushes availability and rates to the channel manager and pulls bookings back, with a webhook and a polling fallback so a missed delivery never becomes a guest arriving to a room nobody knew about. Every exchange is logged.",
    chips: ["Channel Manager", "Mapping", "Inbound Bookings", "Exchange Log"],
  },
] as const

/** Capabilities that are genuinely non-obvious — the reasons an operator switches. */
const CAPABILITIES = [
  {
    n: "01",
    title: "Multi-property from the first day",
    body:
      "One enterprise, many properties, one sign-in. Staff are scoped to a property or to the whole group, and the data never crosses between tenants.",
  },
  {
    n: "02",
    title: "Permissions that actually hold",
    body:
      "Every module carries view, create, update and delete independently, per role. The check runs server-side on each request against the live role — not against a token issued hours ago.",
  },
  {
    n: "03",
    title: "A night audit you can trust",
    body:
      "Room and tax post automatically, the business date advances, and open sessions working in that property are signed out so nobody keeps posting into a closed day.",
  },
  {
    n: "04",
    title: "Guest registration before arrival",
    body:
      "Send a registration link, let the guest fill it in and photograph their ID, then apply it to the reservation. Document reading is assisted by on-device OCR.",
  },
  {
    n: "05",
    title: "Documents that look like the property",
    body:
      "Confirmation letters, registration cards, folios and receipts render in the property's own colours and logo, ready to email or download as PDF.",
  },
  {
    n: "06",
    title: "Every action is on the record",
    body:
      "The activity log keeps who did what and when across the modules that matter, which is what turns a disputed charge into a two-minute answer.",
  },
] as const

/** The platform architecture from the brand guide §06. Only Stay ships today. */
const PLATFORM = [
  { name: "STAY", role: "Property", state: "Live", live: true },
  { name: "STOCK", role: "Inventory", state: "Planned", live: false },
  { name: "PAY", role: "POS", state: "Planned", live: false },
  { name: "DESK", role: "Service", state: "Planned", live: false },
  { name: "RENT", role: "Rentals", state: "Planned", live: false },
] as const

const MARQUEE = [
  "Front Desk", "Reservations", "Tape Chart", "Availability", "Group Blocks",
  "Client Relations", "Housekeeping", "Maintenance", "Fast Post", "Excursions",
  "Spa", "Revenue", "Cashiering", "Debtors", "Night Audit", "Reports",
  "Activity Log", "Channel Manager", "People", "Controls",
] as const

const STATS = [
  { v: 20, suffix: "", label: "Permission-gated modules" },
  { v: 4, suffix: "", label: "Access levels per module" },
  { v: 5, suffix: "", label: "Modules in the platform" },
  { v: 1, suffix: "", label: "Close, run by night audit" },
] as const

export default function InfoPage() {
  return (
    <div className="info-page">
      <InfoScrollEffects />
      <div className="info-progress" aria-hidden="true" />

      {/* -- Top bar ------------------------------------------------------- */}
      <header className="info-top">
        <div className="info-shell info-top-in">
          <Link href="/info" className="info-top-mark" aria-label={PRODUCT_NAME}>
            <UppsolutIcon className="h-8 w-8 shrink-0" title={null} />
            <span className="flex flex-col leading-none">
              <UppsolutWordmark className="h-[13px] w-auto" title={null} />
              <span className="info-mark-sub mt-1.5">Stay</span>
            </span>
          </Link>

          <nav className="info-top-nav" aria-label="Sections">
            <a href="#system">System</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#platform">Platform</a>
          </nav>

          <Link href="/login" className="info-btn info-btn--primary">
            Sign in
          </Link>
        </div>
      </header>

      <main id="main">
        {/* -- Hero -------------------------------------------------------- */}
        <section className="info-hero">
          <div className="info-hero-grid" aria-hidden="true" />
          <div className="info-hero-bloom" aria-hidden="true" />

          <div className="info-shell">
            <p className="info-hero-tag info-reveal">
              <span className="info-hero-dot" aria-hidden="true" />
              Uppsolut Stay · Property Module
            </p>

            {/* The brand's weight split carried into the headline: 900 asserts, 300
                carries. Guide §01. */}
            <h1 className="info-hero-h1 info-reveal" style={{ "--info-delay": "80ms" } as React.CSSProperties}>
              <span className="w-heavy">Absolute control.</span>{" "}
              <span className="w-light">Unstoppable momentum.</span>
            </h1>

            <p className="info-hero-sub info-reveal" style={{ "--info-delay": "160ms" } as React.CSSProperties}>
              The property management system for guesthouses, hotels and resorts. Reservations
              through night audit, front desk through distribution — one system, one source of
              truth, built for the way a property actually runs a day.
            </p>

            <div className="info-hero-actions info-reveal" style={{ "--info-delay": "240ms" } as React.CSSProperties}>
              <a href="#system" className="info-btn info-btn--primary">
                See the system
              </a>
              <Link href="/login" className="info-btn info-btn--ghost">
                Sign in to your property
              </Link>
            </div>

            <div className="info-hero-foot info-reveal" style={{ "--info-delay": "320ms" } as React.CSSProperties}>
              <span className="info-scroll-cue">
                <i aria-hidden="true" />
                Scroll
              </span>
              <span>Business Operating Engine</span>
            </div>
          </div>
        </section>

        {/* -- Module marquee ---------------------------------------------- */}
        <div className="info-marquee" aria-hidden="true">
          {/* Two identical tracks: the second backfills the gap as the first translates
              fully out, which is what makes the loop seamless at any viewport width. */}
          {[0, 1].map((track) => (
            <div className="info-marquee-track" key={track}>
              {MARQUEE.map((m) => (
                <span className="info-marquee-item" key={`${track}-${m}`}>
                  {m}
                </span>
              ))}
            </div>
          ))}
        </div>

        {/* -- 01 The system ----------------------------------------------- */}
        <section className="info-section" id="system">
          <div className="info-shell">
            <div className="info-sec-head info-reveal">
              <span className="info-sec-num">01</span>
              <div>
                <p className="info-eyebrow">The system</p>
                <h2 className="info-h2">A property runs in one order. So does the software.</h2>
                <p className="info-lede">
                  Most property software is a pile of features. This is a day: rooms are sold,
                  guests arrive, services are delivered, money is collected, and the day is
                  closed. <b>Each stage hands off to the next inside the same system</b>, so
                  nothing is re-keyed and nothing is reconciled by hand.
                </p>
              </div>
            </div>

            <div className="info-pin">
              <div className="info-pin-sticky info-reveal">
                <p className="info-eyebrow info-eyebrow--dim">Operational surface</p>
                <h3
                  style={{
                    fontSize: "clamp(24px, 3vw, 38px)",
                    fontWeight: 700,
                    letterSpacing: "-0.025em",
                    lineHeight: 1.06,
                    margin: "14px 0 0",
                  }}
                >
                  Twenty modules. One permission model. No gaps between them.
                </h3>
                <p className="info-lede" style={{ fontSize: 15 }}>
                  Every module is gated on the signed-in role, so a housekeeper sees
                  housekeeping and an owner sees the whole group — from the same build.
                </p>
              </div>

              <div className="info-stage">
                {STAGES.map((stage) => (
                  <article className="info-stage-card info-reveal" key={stage.k}>
                    <p className="info-stage-k">{stage.k}</p>
                    <h3>{stage.title}</h3>
                    <p>{stage.body}</p>
                    <div className="info-chips">
                      {stage.chips.map((c) => (
                        <span key={c}>{c}</span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* -- 02 Capabilities --------------------------------------------- */}
        <section className="info-section" id="capabilities">
          <div className="info-shell">
            <div className="info-sec-head info-reveal">
              <span className="info-sec-num">02</span>
              <div>
                <p className="info-eyebrow">Capabilities</p>
                <h2 className="info-h2">The parts that are hard to get right.</h2>
                <p className="info-lede">
                  Any system can list rooms. These are the places where property software
                  usually breaks — and what this one does about them.
                </p>
              </div>
            </div>

            <div className="info-grid">
              {CAPABILITIES.map((cap, i) => (
                <article
                  className="info-cell info-reveal"
                  key={cap.n}
                  style={{ "--info-delay": `${i * 60}ms` } as React.CSSProperties}
                >
                  <p className="info-cell-n">{cap.n}</p>
                  <h3>{cap.title}</h3>
                  <p>{cap.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* -- 03 Figures --------------------------------------------------- */}
        <section className="info-section">
          <div className="info-shell">
            <div className="info-sec-head info-reveal">
              <span className="info-sec-num">03</span>
              <div>
                <p className="info-eyebrow">By the numbers</p>
                <h2 className="info-h2">Scope, stated plainly.</h2>
              </div>
            </div>

            <div className="info-stats">
              {STATS.map((s, i) => (
                <div
                  className="info-stat info-reveal"
                  key={s.label}
                  style={{ "--info-delay": `${i * 70}ms` } as React.CSSProperties}
                >
                  <p className="info-stat-v">
                    {/* Server-rendered with the final value so a crawler and a no-JS
                        visitor read the real figure; the observer counts up from 0 only
                        when it can. */}
                    <span data-count-to={s.v}>{s.v}</span>
                    {s.suffix}
                  </p>
                  <p className="info-stat-l">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* -- 04 Platform --------------------------------------------------- */}
        <section className="info-section" id="platform">
          <div className="info-shell">
            <div className="info-sec-head info-reveal">
              <span className="info-sec-num">04</span>
              <div>
                <p className="info-eyebrow">Platform</p>
                <h2 className="info-h2">Stay is the property module of a larger engine.</h2>
                <p className="info-lede">
                  Uppsolut is a business operating engine with one identity, one permission
                  model and one design system across every module. <b>Stay ships today</b>;
                  the rest of the architecture is mapped and named, so what you adopt now is
                  the foundation rather than an island.
                </p>
              </div>
            </div>

            <div className="info-modules">
              {PLATFORM.map((m, i) => (
                <div
                  className={`info-module info-reveal${m.live ? " is-live" : ""}`}
                  key={m.name}
                  style={{ "--info-delay": `${i * 60}ms` } as React.CSSProperties}
                >
                  <p className="info-module-state">{m.state}</p>
                  <p className="info-module-name">{m.name}</p>
                  <p className="info-module-role">{m.role}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* -- Closing ------------------------------------------------------- */}
        <section className="info-cta">
          <div className="info-shell">
            <p className="info-eyebrow info-reveal">Uppsolut Stay</p>
            <h2 className="info-reveal" style={{ "--info-delay": "80ms" } as React.CSSProperties}>
              Run the property from one system.
            </h2>
            <div className="info-hero-actions info-reveal" style={{ "--info-delay": "160ms" } as React.CSSProperties}>
              <a href="mailto:hello@uppsolut.com" className="info-btn info-btn--primary">
                Request a demonstration
              </a>
              <Link href="/login" className="info-btn info-btn--ghost">
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="info-foot">
        <div className="info-shell info-foot-in">
          <span>Uppsolut · Business Operating Engine</span>
          <span>© {new Date().getFullYear()} Uppsolut</span>
        </div>
      </footer>
    </div>
  )
}
