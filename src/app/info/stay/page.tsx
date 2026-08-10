import type { Metadata } from "next"
import Link from "next/link"
import { PRODUCTS, otherProducts, CONTACT_EMAIL } from "../products"

/**
 * Uppsolut Stay — the property management product.
 *
 * This is the only page of the three whose claims describe software that exists: it
 * documents THIS repository. Every capability below is checkable against the shipped app,
 * which is why it carries specifics (night audit rolling the business date, the polling
 * fallback behind the channel webhook) that the other two product pages cannot yet.
 *
 * Chrome, theming and scroll behaviour come from the shared layout in ../layout.tsx.
 */

const DESCRIPTION =
  "Uppsolut Stay is a property management system for guesthouses, hotels and resorts — reservations, front desk, housekeeping, revenue, night audit and channel distribution in one operational system."

export const metadata: Metadata = {
  title: "Uppsolut Stay — property management for guesthouses, hotels and resorts",
  description: DESCRIPTION,
  keywords: [
    "property management system",
    "PMS",
    "hotel software",
    "guesthouse management",
    "resort management",
    "channel manager",
    "night audit",
    "tape chart",
    "Uppsolut Stay",
  ],
  alternates: { canonical: "/info/stay" },
  openGraph: {
    type: "website",
    url: "/info/stay",
    title: "Uppsolut Stay — property management, end to end",
    description: DESCRIPTION,
    siteName: "Uppsolut",
  },
  twitter: { card: "summary_large_image", title: "Uppsolut Stay", description: DESCRIPTION },
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

/** The parts that are genuinely hard — the reasons an operator switches. */
const CAPABILITIES = [
  {
    n: "01",
    title: "Multi-property from the first day",
    body: "One enterprise, many properties, one sign-in. Staff are scoped to a property or to the whole group, and the data never crosses between tenants.",
  },
  {
    n: "02",
    title: "Permissions that actually hold",
    body: "Every module carries view, create, update and delete independently, per role. The check runs server-side on each request against the live role — not against a token issued hours ago.",
  },
  {
    n: "03",
    title: "A night audit you can trust",
    body: "Room and tax post automatically, the business date advances, and open sessions working in that property are signed out so nobody keeps posting into a closed day.",
  },
  {
    n: "04",
    title: "Guest registration before arrival",
    body: "Send a registration link, let the guest fill it in and photograph their ID, then apply it to the reservation. Document reading is assisted by on-device OCR.",
  },
  {
    n: "05",
    title: "Documents that look like the property",
    body: "Confirmation letters, registration cards, folios and receipts render in the property's own colours and logo, ready to email or download as PDF.",
  },
  {
    n: "06",
    title: "Every action is on the record",
    body: "The activity log keeps who did what and when across the modules that matter, which is what turns a disputed charge into a two-minute answer.",
  },
] as const

const MARQUEE = [
  "Front Desk", "Reservations", "Tape Chart", "Availability", "Group Blocks",
  "Client Relations", "Housekeeping", "Maintenance", "Fast Post", "Excursions",
  "Spa", "Revenue", "Cashiering", "Debtors", "Night Audit", "Reports",
  "Activity Log", "Channel Manager", "People", "Controls",
] as const

const STATS = [
  { v: 20, label: "Permission-gated modules" },
  { v: 4, label: "Access levels per module" },
  { v: 5, label: "Modules in the platform" },
  { v: 1, label: "Close, run by night audit" },
] as const

export default function StayPage() {
  const others = otherProducts("stay")

  return (
    <>
      {/* -- Hero ---------------------------------------------------------- */}
      <section className="info-hero">
        <div className="info-hero-grid" aria-hidden="true" />
        <div className="info-hero-bloom" aria-hidden="true" />

        <div className="info-shell">
          <p className="info-hero-tag info-reveal">
            <span className="info-hero-dot" aria-hidden="true" />
            Uppsolut Stay · Property management · Live
          </p>

          <h1 className="info-hero-h1 info-reveal" style={{ "--info-delay": "80ms" } as React.CSSProperties}>
            <span className="w-heavy">One system.</span>{" "}
            <span className="w-light">The whole property.</span>
          </h1>

          <p className="info-hero-sub info-reveal" style={{ "--info-delay": "160ms" } as React.CSSProperties}>
            Property management for guesthouses, hotels and resorts. Reservations through
            night audit, front desk through distribution — one source of truth, built for
            the way a property actually runs a day.
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
            <span>Guesthouses · Hotels · Resorts</span>
          </div>
        </div>
      </section>

      {/* -- Module marquee ------------------------------------------------ */}
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

      {/* -- 01 The system ------------------------------------------------- */}
      <section className="info-section" id="system">
        <div className="info-shell">
          <div className="info-sec-head info-reveal">
            <span className="info-sec-num">01</span>
            <div>
              <p className="info-eyebrow">The system</p>
              <h2 className="info-h2">A property runs in one order. So does the software.</h2>
              <p className="info-lede">
                Most property software is a pile of features. This is a day: rooms are
                sold, guests arrive, services are delivered, money is collected, and the
                day is closed. <b>Each stage hands off to the next inside the same
                system</b>, so nothing is re-keyed and nothing is reconciled by hand.
              </p>
            </div>
          </div>

          <div className="info-pin">
            <div className="info-pin-sticky info-reveal">
              <p className="info-eyebrow info-eyebrow--dim">Operational surface</p>
              <h3 className="info-h3">Twenty modules. One permission model. No gaps between them.</h3>
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

      {/* -- 02 Capabilities ----------------------------------------------- */}
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

      {/* -- 03 Figures ----------------------------------------------------- */}
      <section className="info-section info-section--tight">
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
                {/* Server-rendered with the final value so a crawler and a no-JS visitor
                    read the real figure; the observer counts up from 0 only when it can. */}
                <p className="info-stat-v" data-count-to={s.v}>
                  {s.v}
                </p>
                <p className="info-stat-l">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -- 04 The rest of the platform ------------------------------------ */}
      <section className="info-section" id="platform">
        <div className="info-shell">
          <div className="info-sec-head info-reveal">
            <span className="info-sec-num">04</span>
            <div>
              <p className="info-eyebrow">Platform</p>
              <h2 className="info-h2">Stay is one product of three.</h2>
              <p className="info-lede">
                The same identity, permission model and design system carry across the
                line, so adopting a second product is not a second migration.
              </p>
            </div>
          </div>

          <div className="info-modules">
            {PRODUCTS.map((p, i) => (
              <Link
                key={p.slug}
                href={`/info/${p.slug}`}
                className={`info-module info-reveal${p.slug === "stay" ? " is-live" : ""}`}
                style={{ "--info-delay": `${i * 60}ms` } as React.CSSProperties}
              >
                <p className="info-module-state">{p.status}</p>
                <p className="info-module-name">{p.mark}</p>
                <p className="info-module-role">{p.role}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* -- Closing -------------------------------------------------------- */}
      <section className="info-cta">
        <div className="info-shell">
          <p className="info-eyebrow info-reveal">Uppsolut Stay</p>
          <h2 className="info-reveal" style={{ "--info-delay": "80ms" } as React.CSSProperties}>
            Run the property from one system.
          </h2>
          <div className="info-hero-actions info-reveal" style={{ "--info-delay": "160ms" } as React.CSSProperties}>
            <a href={`mailto:${CONTACT_EMAIL}?subject=Uppsolut%20Stay`} className="info-btn info-btn--primary">
              Request a demonstration
            </a>
            <Link href={`/info/${others[0].slug}`} className="info-btn info-btn--ghost">
              See {others[0].name}
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
