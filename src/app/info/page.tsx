import type { Metadata } from "next"
import Link from "next/link"
import { PRODUCTS, CONTACT_EMAIL } from "./products"

/**
 * The company overview — what Uppsolut is, and the three products under it.
 *
 * COPY RULES. Voice is branding-guide §09: short, declarative, verbs that move, no hype.
 * DESIGN_PLAN §0.2 additionally bans "Elevate", "Seamless", "Unleash", "Next-Gen" and
 * "Revolutionize"; that ban is honoured here too, which is why the supplied sample's
 * "Next-Gen Cloud & Business Applications" badge does not survive into this page.
 *
 * NO FABRICATED PROOF. The sample this page was based on carried a metrics band —
 * "99.99% Uptime SLA", "<10ms Terminal Response", "24/7 Support & Monitoring". None of
 * those are measured, and an uptime SLA in particular is a contractual promise, not a
 * decoration; publishing one the business has not committed to is a liability in a sales
 * conversation. They are replaced below with facts that are true of the software as
 * built. Same reasoning as the absent testimonials and customer logos.
 */

const SITE_DESCRIPTION =
  "Uppsolut builds operational software for property, retail and rentals — Uppsolut Stay for guesthouses, hotels and resorts, Uppsolut POS for retail, and Rent Manager for rental portfolios."

export const metadata: Metadata = {
  title: "Operational software for property, retail and rentals",
  description: SITE_DESCRIPTION,
  keywords: [
    "Uppsolut",
    "property management system",
    "PMS",
    "point of sale",
    "POS software",
    "rental management software",
    "hotel software",
    "guesthouse management",
    "Maldives software",
  ],
  alternates: { canonical: "/info" },
  openGraph: {
    type: "website",
    url: "/info",
    title: "Uppsolut — operational software for property, retail and rentals",
    description: SITE_DESCRIPTION,
    siteName: "Uppsolut",
  },
  twitter: {
    card: "summary_large_image",
    title: "Uppsolut — operational software for property, retail and rentals",
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
}

/** What is actually shared across the products — the reason they are one company. */
const FOUNDATIONS = [
  {
    n: "01",
    title: "One identity across the group",
    body: "A person, their role and what they may open is decided once, at the enterprise level, and every product reads the same answer.",
  },
  {
    n: "02",
    title: "Permissions checked server-side",
    body: "View, create, update and delete are held independently per module, per role, and re-checked on every request against the live record rather than a token issued hours ago.",
  },
  {
    n: "03",
    title: "Tenants that cannot see each other",
    body: "Every query is scoped to the enterprise that asked. Isolation is enforced in the data layer and covered by its own test suite, not left to a forgotten WHERE clause.",
  },
  {
    n: "04",
    title: "One design system",
    body: "The same type, palette and interaction rules across every product, so a team that learns one already knows how the next one behaves.",
  },
] as const

export default function InfoIndexPage() {
  return (
    <>
      {/* -- Hero ---------------------------------------------------------- */}
      <section className="info-hero">
        <div className="info-hero-grid" aria-hidden="true" />
        <div className="info-hero-bloom" aria-hidden="true" />

        <div className="info-shell">
          <p className="info-hero-tag info-reveal">
            <span className="info-hero-dot" aria-hidden="true" />
            Business Operating Engine
          </p>

          {/* The brand tagline belongs to the company, so it leads here — the product
              pages carry their own headline rather than repeating it. */}
          <h1 className="info-hero-h1 info-reveal" style={{ "--info-delay": "80ms" } as React.CSSProperties}>
            <span className="w-heavy">Absolute control.</span>{" "}
            <span className="w-light">Unstoppable momentum.</span>
          </h1>

          <p className="info-hero-sub info-reveal" style={{ "--info-delay": "160ms" } as React.CSSProperties}>
            Uppsolut builds the software a business actually runs on. Property, retail and
            rentals — separate products, one engine underneath, so the parts of an
            operation stop being separate systems that disagree.
          </p>

          <div className="info-hero-actions info-reveal" style={{ "--info-delay": "240ms" } as React.CSSProperties}>
            <a href="#products" className="info-btn info-btn--primary">
              See the products
            </a>
            <a href="#contact" className="info-btn info-btn--ghost">
              Talk to us
            </a>
          </div>

          <div className="info-hero-foot info-reveal" style={{ "--info-delay": "320ms" } as React.CSSProperties}>
            <span className="info-scroll-cue">
              <i aria-hidden="true" />
              Scroll
            </span>
            <span>Property · Retail · Rentals</span>
          </div>
        </div>
      </section>

      {/* -- 01 Products --------------------------------------------------- */}
      <section className="info-section" id="products">
        <div className="info-shell">
          <div className="info-sec-head info-reveal">
            <span className="info-sec-num">01</span>
            <div>
              <p className="info-eyebrow">The products</p>
              <h2 className="info-h2">Three operations. Three systems built for them.</h2>
              <p className="info-lede">
                Each product is shaped around how its trade actually works rather than a
                generic record-keeper with the labels changed. <b>They share an engine</b>,
                so a group running more than one is not running more than one company.
              </p>
            </div>
          </div>

          <div className="info-products">
            {PRODUCTS.map((p, i) => (
              <Link
                key={p.slug}
                href={`/info/${p.slug}`}
                className="info-product info-reveal"
                style={{ "--info-delay": `${i * 70}ms` } as React.CSSProperties}
              >
                <div className="info-product-head">
                  <span className="info-cell-n">{String(i + 1).padStart(2, "0")}</span>
                  <span className={`info-status${p.status === "Live" ? " info-status--live" : ""}`}>
                    {p.status}
                  </span>
                </div>

                <p className="info-product-mark">{p.mark}</p>
                <p className="info-product-name">{p.name}</p>
                <p>{p.summary}</p>

                <ul className="info-list">
                  {p.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>

                <span className="info-product-go">
                  <span>{p.role}</span>
                  <span aria-hidden="true">→</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* -- 02 What is shared --------------------------------------------- */}
      <section className="info-section" id="engine">
        <div className="info-shell">
          <div className="info-sec-head info-reveal">
            <span className="info-sec-num">02</span>
            <div>
              <p className="info-eyebrow">The engine</p>
              <h2 className="info-h2">What every product inherits.</h2>
              <p className="info-lede">
                &ldquo;One platform&rdquo; is easy to claim and mostly meaningless. These
                are the specific things that are built once and shared, and the reason
                adding a second product is not a second migration.
              </p>
            </div>
          </div>

          <div className="info-grid info-grid--4">
            {FOUNDATIONS.map((f, i) => (
              <article
                className="info-cell info-reveal"
                key={f.n}
                style={{ "--info-delay": `${i * 60}ms` } as React.CSSProperties}
              >
                <p className="info-cell-n">{f.n}</p>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* -- 03 Contact ---------------------------------------------------- */}
      <section className="info-section" id="contact">
        <div className="info-shell">
          <div className="info-sec-head info-reveal">
            <span className="info-sec-num">03</span>
            <div>
              <p className="info-eyebrow">Get in touch</p>
              <h2 className="info-h2">Tell us what you run.</h2>
              <p className="info-lede">
                A demonstration is the fastest way to judge whether this fits your
                operation. Say which product you are looking at and roughly how big the
                property, store or portfolio is, and we will show the relevant parts.
              </p>
            </div>
          </div>

          <div className="info-contact">
            {/* A mailto rather than a form on purpose: the supplied sample's form called
                alert() and sent nothing, which is worse than no form — someone would
                believe they had made contact. Wire this to the platform mailer
                (src/lib/mailer.ts) when the page moves to the marketing domain. */}
            <div className="info-contact-rows info-reveal">
              <a className="info-contact-row" href={`mailto:${CONTACT_EMAIL}`}>
                <span className="info-contact-k">Email</span>
                <span className="info-contact-v">{CONTACT_EMAIL}</span>
              </a>
              <div className="info-contact-row">
                <span className="info-contact-k">Web</span>
                <span className="info-contact-v">uppsolut.com</span>
              </div>
              <Link className="info-contact-row" href="/login">
                <span className="info-contact-k">Existing customer</span>
                <span className="info-contact-v">Sign in →</span>
              </Link>
            </div>

            <div className="info-reveal" style={{ "--info-delay": "80ms" } as React.CSSProperties}>
              <p className="info-eyebrow info-eyebrow--dim">Which product</p>
              <ul className="info-list" style={{ marginTop: 16 }}>
                {PRODUCTS.map((p) => (
                  <li key={p.slug}>
                    <Link href={`/info/${p.slug}`} style={{ color: "inherit" }}>
                      {p.name} — {p.role.toLowerCase()}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* -- Closing ------------------------------------------------------- */}
      <section className="info-cta">
        <div className="info-shell">
          <p className="info-eyebrow info-reveal">Uppsolut</p>
          <h2 className="info-reveal" style={{ "--info-delay": "80ms" } as React.CSSProperties}>
            One engine. Every part of the operation.
          </h2>
          <div className="info-hero-actions info-reveal" style={{ "--info-delay": "160ms" } as React.CSSProperties}>
            <a href={`mailto:${CONTACT_EMAIL}`} className="info-btn info-btn--primary">
              Request a demonstration
            </a>
            <Link href="/info/stay" className="info-btn info-btn--ghost">
              Start with Stay
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
