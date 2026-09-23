import type { Metadata } from "next"
import Link from "next/link"
import { UppsolutIcon } from "@/components/brand/uppsolut-logo"
import { DocsSidebar, DOCS_MENU_ID } from "./sidebar"
import { OPENAPI_URL, PDF_URL } from "./nav"
import "./docs.css"

/**
 * The public documentation portal — guides for the web developers who build a property's
 * website against the Booking API, and for the administrators and staff who run it
 * (BOOKING_API_ADDONS_PLAN.md Phase 6). Public by design: src/proxy.ts only protects the
 * dashboard. Nothing here reads session, database or tenant data — every page is static
 * content — and `npm run docs:check` fails the build if a page ever carries a secret, a
 * real customer's name or an internal detail (scripts/docs-check.ts).
 */
export const metadata: Metadata = {
  title: { default: "Uppsolut Stay Docs", template: "%s — Uppsolut Stay Docs" },
  description: "Guides and API reference for connecting a property's own website to Uppsolut Stay.",
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs-page">
      {/* Phone menu: a checkbox + label, no script needed to open it. */}
      <input type="checkbox" id={DOCS_MENU_ID} className="docs-menu-state" aria-hidden="true" tabIndex={-1} />
      <header className="docs-header">
        <Link href="/docs" className="docs-brand" aria-label="Uppsolut Stay documentation">
          <UppsolutIcon className="h-7 w-7 shrink-0" title={null} />
          <span>Uppsolut Stay</span>
          <span className="docs-brand-sep">Docs</span>
        </Link>
        <label htmlFor={DOCS_MENU_ID} className="docs-menu-toggle">Menu</label>
        <nav className="docs-header-links" aria-label="Downloads">
          <a href={OPENAPI_URL}>OpenAPI</a>
          <a href={PDF_URL}>PDF</a>
          <Link href="/login">Sign in</Link>
        </nav>
      </header>
      <div className="docs-shell">
        <DocsSidebar />
        <main id="main" className="docs-main">
          <article className="docs-article">{children}</article>
        </main>
      </div>
    </div>
  )
}
