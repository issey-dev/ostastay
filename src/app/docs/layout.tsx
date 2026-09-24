import type { Metadata } from "next"
import Link from "next/link"
import { UppsolutIcon } from "@/components/brand/uppsolut-logo"
import { DocsHeaderNav, DocsSidebar, DOCS_MENU_ID } from "./sidebar"
import "./docs.css"

/**
 * The public documentation portal, in three areas (see nav.ts): the Booking API for web
 * developers (BOOKING_API_ADDONS_PLAN.md Phase 6), Configuration for the administrators and
 * property teams who set a property up in the Hub, and Operations for day-to-day staff.
 * Public by design: src/proxy.ts only protects the dashboard. Nothing here reads session, database or tenant data — every page is static
 * content — and `npm run docs:check` fails the build if a page ever carries a secret, a
 * real customer's name or an internal detail (scripts/docs-check.ts).
 */
export const metadata: Metadata = {
  title: { default: "Uppsolut Stay Docs", template: "%s — Uppsolut Stay Docs" },
  description: "Configuration guides, operations guides and the Booking API reference for Uppsolut Stay.",
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
        <DocsHeaderNav />
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
