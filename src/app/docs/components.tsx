import Link from "next/link"
import { DOC_AREAS, areaLinks } from "./nav"

// The handful of building blocks every docs page is written with. Plain server components:
// the pages are static content and ship no JavaScript beyond the copy buttons.

export { CodeBlock } from "./code-block"

export function DocTitle({ title, lead }: { title: string; lead?: string }) {
  return (
    <>
      <h1>{title}</h1>
      {lead && <p className="docs-lead">{lead}</p>}
    </>
  )
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")

export function H2({ children, id }: { children: string; id?: string }) {
  return <h2 id={id ?? slug(children)}>{children}</h2>
}

export function H3({ children, id }: { children: string; id?: string }) {
  return <h3 id={id ?? slug(children)}>{children}</h3>
}

export function Endpoint({ method, path, note }: { method: "GET" | "POST"; path: string; note?: string }) {
  return (
    <div className="docs-endpoint">
      <span className={`docs-method docs-method-${method}`}>{method}</span>
      <span className="docs-endpoint-path">{path}</span>
      {note && <span className="docs-endpoint-tag">{note}</span>}
    </div>
  )
}

export function Callout({ title, tone = "note", children }: { title?: string; tone?: "note" | "warn"; children: React.ReactNode }) {
  return (
    <div className={`docs-callout${tone === "warn" ? " docs-callout-warn" : ""}`}>
      {title && <div className="docs-callout-title">{title}</div>}
      {children}
    </div>
  )
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="docs-table-wrap">
      <table className="docs-table">
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Cards({ items }: { items: { href: string; title: string; body: string }[] }) {
  return (
    <div className="docs-cards">
      {items.map((c) => (
        <Link key={c.href} href={c.href} className="docs-card">
          <div className="docs-card-title">{c.title}</div>
          <div className="docs-card-body">{c.body}</div>
        </Link>
      ))}
    </div>
  )
}

/** Previous / next page, in the area's table-of-contents order. */
export function Pager({ href }: { href: string }) {
  const links = areaLinks(DOC_AREAS.find((a) => areaLinks(a).some((l) => l.href === href)) ?? DOC_AREAS[0])
  const i = links.findIndex((l) => l.href === href)
  const prev = i > 0 ? links[i - 1] : null
  const next = i >= 0 && i < links.length - 1 ? links[i + 1] : null
  return (
    <nav className="docs-pager" aria-label="Pages">
      <span>{prev && <Link href={prev.href}>← {prev.title}</Link>}</span>
      <span>{next && <Link href={next.href}>{next.title} →</Link>}</span>
    </nav>
  )
}

/**
 * A screenshot of the app — the main content only, never the app's sidebar or header —
 * captured by `npm run docs:shots` into public/docs/img. `name` is the file name without
 * its extension; the image is lazy-loaded so a long guide stays light.
 */
export function Shot({ name, alt, caption }: { name: string; alt: string; caption?: string }) {
  return (
    <figure className="docs-shot">
      {/* eslint-disable-next-line @next/next/no-img-element -- static docs asset, next/image is disabled app-wide */}
      <img src={`/docs/img/${name}.webp`} alt={alt} loading="lazy" decoding="async" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

/** "Where": the menu path to the screen a section describes, and who may open it. */
export function Where({ path, who }: { path: string; who?: string }) {
  return (
    <p className="docs-where">
      <strong>Where:</strong> {path}
      {who && (
        <>
          {" · "}
          <strong>Who:</strong> {who}
        </>
      )}
    </p>
  )
}
