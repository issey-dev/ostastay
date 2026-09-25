import type { Metadata } from "next"
import { DocTitle, Pager } from "../components"
import { EARLIER_DEVELOPMENT, RELEASES, releaseAnchor } from "./releases"

export const metadata: Metadata = { title: "Release notes" }

// Every released version, newest first — what it added, improved and fixed. The entries
// live in ./releases.ts; add the new version at the top when you tag a release.
export default function ReleaseNotes() {
  const latest = RELEASES[0]
  return (
    <>
      <DocTitle
        title="Release notes"
        lead={`What each version of Uppsolut Stay added, improved and fixed. The current version is ${latest.version}.`}
      />

      <nav aria-label="Versions" className="docs-release-index">
        {RELEASES.map((r) => (
          <a key={r.version} href={`#${releaseAnchor(r.version)}`}>
            {r.version}
          </a>
        ))}
      </nav>

      {RELEASES.map((r) => (
        <section key={r.version} className="docs-release">
          <h2 id={releaseAnchor(r.version)}>
            {r.version}
            <span className="docs-release-date">{formatDate(r.date)}</span>
          </h2>
          {r.highlights && <p className="docs-lead-sm">{r.highlights}</p>}
          <Group title="New" items={r.new} />
          <Group title="Improved" items={r.improved} />
          <Group title="Fixed" items={r.fixed} />
        </section>
      ))}

      <section className="docs-release">
        <h2 id="earlier">{EARLIER_DEVELOPMENT.title}</h2>
        <p className="docs-lead-sm">{EARLIER_DEVELOPMENT.intro}</p>
        <ul>
          {EARLIER_DEVELOPMENT.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <Pager href="/docs/release-notes" />
    </>
  )
}

function Group({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <>
      <h3 className="docs-release-group">{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  )
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
}
