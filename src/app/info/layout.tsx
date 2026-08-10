import type { Metadata } from "next"
import Link from "next/link"
import { cookies } from "next/headers"
import { UppsolutIcon, UppsolutWordmark } from "@/components/brand/uppsolut-logo"
import { InfoScrollEffects } from "./scroll-effects"
import { InfoThemeToggle } from "./theme-toggle"
import { INFO_THEME_COOKIE } from "./theme"
import { InfoNav } from "./nav"
import { PRODUCTS, CONTACT_EMAIL } from "./products"
import "./info.css"

/**
 * Shared chrome for every page under /info.
 *
 * MOCKUP, PENDING RELOCATION. These pages live inside the application only so the team can
 * review them on a real URL; the intended home is the marketing domain. Nothing in this
 * folder imports session, Prisma or app state — the only product dependency is the two
 * brand mark components — so relocating the folder is a copy, not a rewrite.
 *
 * WHY force-dynamic LIVES HERE. Route-segment config in a layout applies to every child
 * segment, so declaring it once covers all four pages. These pages have no dynamic data,
 * so Next would otherwise prerender them at build time — and the Docker build (see
 * Dockerfile) supplies only JWT_SECRET and DATABASE_URL, never APP_URL. Prerendering
 * therefore froze the canonical URL at its localhost fallback and shipped
 * `<link rel="canonical" href="http://localhost:3000/info">` to production, pointing
 * search engines at a host that does not exist. Verified by inspecting
 * .next/server/app/info.html from a build with APP_URL unset. Rendering per request
 * resolves APP_URL from the runtime environment (compose passes it via env_file) and also
 * keeps the footer's copyright year honest rather than fixing it to the image build date.
 */
export const dynamic = "force-dynamic"

/**
 * Absolute base for every canonical and og: URL under /info.
 *
 * Declared once HERE rather than per page: layout metadata is merged into each child's,
 * so all four pages inherit it and none can be added later that quietly forgets it —
 * which is exactly how it regressed once already. Without a metadataBase Next emits
 * `<link rel="canonical" href="/info/stay">`, and a relative canonical is close to
 * useless: the entire job of the tag is to name ONE absolute URL when a page is reachable
 * by several, which is the situation these pages are heading into at the domain move.
 *
 * APP_URL is the variable the rest of the app already builds public links from (see
 * src/lib/email-templates.ts), so this follows the environment automatically. The
 * localhost fallback only ever applies in dev — production sets it, and `force-dynamic`
 * above is what guarantees it is read at request time rather than frozen at build.
 */
export const metadata: Metadata = {
  metadataBase: new URL((process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "")),
}

export default async function InfoLayout({ children }: { children: React.ReactNode }) {
  // The colour preference is resolved on the server so the correct theme is in the first
  // byte of HTML — no flash, no inline script, and it still works with JS disabled. Dark
  // is the brand's presentation and therefore the default; only an explicit "light" wins.
  const isLight = (await cookies()).get(INFO_THEME_COOKIE)?.value === "light"

  return (
    <>
      <div className={`info-page${isLight ? " info-light" : ""}`}>
        <InfoScrollEffects />
        <div className="info-progress" aria-hidden="true" />

        <header className="info-top">
          <div className="info-shell info-top-in">
            <Link href="/info" className="info-top-mark" aria-label="Uppsolut — home">
              <UppsolutIcon className="h-8 w-8 shrink-0" title={null} />
              <span className="flex flex-col leading-none">
                <UppsolutWordmark className="h-[13px] w-auto" title={null} />
                <span className="info-mark-sub mt-1.5">Business Operating Engine</span>
              </span>
            </Link>

            <InfoNav />

            <div className="info-top-actions">
              <InfoThemeToggle initialIsLight={isLight} />
              <Link href="/login" className="info-btn info-btn--primary">
                Sign in
              </Link>
            </div>
          </div>
        </header>

        <main id="main">{children}</main>

        <footer className="info-foot">
          <div className="info-shell">
            <div className="info-foot-grid">
              <div className="info-foot-links">
                <Link href="/info">Overview</Link>
                {PRODUCTS.map((p) => (
                  <Link key={p.slug} href={`/info/${p.slug}`}>
                    {p.name}
                  </Link>
                ))}
                <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
              </div>
            </div>
            <p className="info-foot-legal">
              Uppsolut · Business Operating Engine · © {new Date().getFullYear()}
            </p>
          </div>
        </footer>
      </div>
    </>
  )
}
