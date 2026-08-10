import Link from "next/link"
import { type Product, otherProducts, CONTACT_EMAIL } from "./products"

/**
 * The shared body for a product page that is not yet shipping.
 *
 * WHY A SHARED TEMPLATE. POS and Rent Manager are at the same stage and say the same
 * KINDS of things; two hand-written pages would drift apart within a week of edits. Stay
 * deliberately does NOT use this — it describes software that exists, so it earns its own
 * page with specifics this template cannot honestly express.
 *
 * HONESTY ABOUT STATUS. Both products render a plain "In development" state and a section
 * that says so in words. The supplied sample described them in the present tense as
 * though they were purchasable; a prospect who buys on that basis becomes a support
 * problem and a credibility problem. The capability lists below are therefore written as
 * what the product is being built to do, not as a feature inventory.
 */

export type ProductPageContent = {
  /** Two-part hero headline carrying the brand's 900/300 weight split. */
  headlineHeavy: string
  headlineLight: string
  intro: string
  /** The problem this product exists to remove. */
  problem: { title: string; body: string }
  /** Four to six capabilities, written as intent rather than as shipped fact. */
  capabilities: readonly { n: string; title: string; body: string }[]
  /** Short strip of the nouns this product deals in — the marquee. */
  marquee: readonly string[]
}

export function ProductPage({ product, content }: { product: Product; content: ProductPageContent }) {
  const others = otherProducts(product.slug)

  return (
    <>
      {/* -- Hero ---------------------------------------------------------- */}
      <section className="info-hero">
        <div className="info-hero-grid" aria-hidden="true" />
        <div className="info-hero-bloom" aria-hidden="true" />

        <div className="info-shell">
          <p className="info-hero-tag info-reveal">
            <span className="info-hero-dot" aria-hidden="true" />
            {product.name} · {product.role} · {product.status}
          </p>

          <h1 className="info-hero-h1 info-reveal" style={{ "--info-delay": "80ms" } as React.CSSProperties}>
            <span className="w-heavy">{content.headlineHeavy}</span>{" "}
            <span className="w-light">{content.headlineLight}</span>
          </h1>

          <p className="info-hero-sub info-reveal" style={{ "--info-delay": "160ms" } as React.CSSProperties}>
            {content.intro}
          </p>

          <div className="info-hero-actions info-reveal" style={{ "--info-delay": "240ms" } as React.CSSProperties}>
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(product.name)}`}
              className="info-btn info-btn--primary"
            >
              Register interest
            </a>
            <a href="#capabilities" className="info-btn info-btn--ghost">
              What it will do
            </a>
          </div>

          <div className="info-hero-foot info-reveal" style={{ "--info-delay": "320ms" } as React.CSSProperties}>
            <span className="info-scroll-cue">
              <i aria-hidden="true" />
              Scroll
            </span>
            <span>{product.status}</span>
          </div>
        </div>
      </section>

      {/* -- Marquee -------------------------------------------------------- */}
      <div className="info-marquee" aria-hidden="true">
        {[0, 1].map((track) => (
          <div className="info-marquee-track" key={track}>
            {content.marquee.map((m) => (
              <span className="info-marquee-item" key={`${track}-${m}`}>
                {m}
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* -- 01 The problem -------------------------------------------------- */}
      <section className="info-section" id="why">
        <div className="info-shell">
          <div className="info-sec-head info-reveal">
            <span className="info-sec-num">01</span>
            <div>
              <p className="info-eyebrow">Why it exists</p>
              <h2 className="info-h2">{content.problem.title}</h2>
              <p className="info-lede">{content.problem.body}</p>
            </div>
          </div>
        </div>
      </section>

      {/* -- 02 Capabilities -------------------------------------------------- */}
      <section className="info-section" id="capabilities">
        <div className="info-shell">
          <div className="info-sec-head info-reveal">
            <span className="info-sec-num">02</span>
            <div>
              <p className="info-eyebrow">Capabilities</p>
              <h2 className="info-h2">What it is being built to do.</h2>
              <p className="info-lede">
                Written as intent, not as an inventory — {product.name} is{" "}
                <b>{product.status.toLowerCase()}</b>. Scope is firm; the detail will move
                as it is built against real operations.
              </p>
            </div>
          </div>

          <div className="info-grid">
            {content.capabilities.map((c, i) => (
              <article
                className="info-cell info-reveal"
                key={c.n}
                style={{ "--info-delay": `${i * 60}ms` } as React.CSSProperties}
              >
                <p className="info-cell-n">{c.n}</p>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* -- 03 Status, stated plainly ---------------------------------------- */}
      <section className="info-section info-section--tight" id="status">
        <div className="info-shell">
          <div className="info-sec-head info-reveal">
            <span className="info-sec-num">03</span>
            <div>
              <p className="info-eyebrow">Where it stands</p>
              <h2 className="info-h2">{product.status}.</h2>
              <p className="info-lede">
                {product.name} is not available to buy yet. Uppsolut Stay — the property
                product — is live today and shares the identity, permission model and
                design system this one is being built on, so an early conversation now is
                a real one rather than a waiting list.{" "}
                <b>Register interest and we will show you where it is.</b>
              </p>
            </div>
          </div>

          <div className="info-split info-reveal">
            <div>
              <p className="info-eyebrow info-eyebrow--dim">Available today</p>
              <h3 className="info-h3">Uppsolut Stay</h3>
              <p className="info-lede" style={{ fontSize: 14.5 }}>
                Property management for guesthouses, hotels and resorts — reservations,
                front desk, housekeeping, revenue, night audit and channel distribution.
              </p>
              <p style={{ marginTop: 22 }}>
                <Link href="/info/stay" className="info-btn info-btn--ghost">
                  See Uppsolut Stay
                </Link>
              </p>
            </div>
            <div>
              <p className="info-eyebrow info-eyebrow--dim">This product</p>
              <h3 className="info-h3">{product.name}</h3>
              <p className="info-lede" style={{ fontSize: 14.5 }}>
                {product.summary}
              </p>
              <p style={{ marginTop: 22 }}>
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(product.name)}`}
                  className="info-btn info-btn--primary"
                >
                  Register interest
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* -- 04 The rest of the line ------------------------------------------ */}
      <section className="info-section" id="platform">
        <div className="info-shell">
          <div className="info-sec-head info-reveal">
            <span className="info-sec-num">04</span>
            <div>
              <p className="info-eyebrow">Platform</p>
              <h2 className="info-h2">One engine under all three.</h2>
              <p className="info-lede">
                Identity, permissions and the design system are built once and shared, so a
                group running more than one product is not running more than one company.
              </p>
            </div>
          </div>

          <div className="info-modules">
            {others.concat(product).map((p, i) => (
              <Link
                key={p.slug}
                href={`/info/${p.slug}`}
                className={`info-module info-reveal${p.slug === product.slug ? " is-live" : ""}`}
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

      {/* -- Closing ---------------------------------------------------------- */}
      <section className="info-cta">
        <div className="info-shell">
          <p className="info-eyebrow info-reveal">{product.name}</p>
          <h2 className="info-reveal" style={{ "--info-delay": "80ms" } as React.CSSProperties}>
            Tell us what you run.
          </h2>
          <div className="info-hero-actions info-reveal" style={{ "--info-delay": "160ms" } as React.CSSProperties}>
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(product.name)}`}
              className="info-btn info-btn--primary"
            >
              Register interest
            </a>
            <Link href="/info" className="info-btn info-btn--ghost">
              All products
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
