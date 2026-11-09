"use client"

import { useEffect, useState } from "react"
import { EARLIER_DEVELOPMENT, RELEASES, releaseAnchor } from "./releases"

// Release notes: one version at a time. The tab row shows the newest VISIBLE versions and a
// button for older ones. Every section is still in the page (hidden on screen) and all of
// them show in print, so the PDF built from this page keeps the full history.
const VISIBLE = 10
const EARLIER = "earlier"

export function ReleaseTabs() {
  const [selected, setSelected] = useState<string>(RELEASES[0].version)
  const [showOlder, setShowOlder] = useState(false)

  // A link like /docs/release-notes#v8-12-0 opens that version (and reveals older tabs).
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    if (hash === EARLIER) {
      setSelected(EARLIER)
      setShowOlder(true)
      return
    }
    const i = RELEASES.findIndex((r) => releaseAnchor(r.version) === hash)
    if (i >= 0) {
      setSelected(RELEASES[i].version)
      if (i >= VISIBLE) setShowOlder(true)
    }
  }, [])

  function select(key: string) {
    setSelected(key)
    const anchor = key === EARLIER ? EARLIER : releaseAnchor(key)
    window.history.replaceState(null, "", `#${anchor}`)
  }

  const tabs = showOlder ? RELEASES : RELEASES.slice(0, VISIBLE)
  const hasOlder = RELEASES.length > VISIBLE

  return (
    <>
      <div role="tablist" aria-label="Versions" className="docs-release-index">
        {tabs.map((r) => (
          <button
            key={r.version}
            type="button"
            role="tab"
            aria-selected={selected === r.version}
            onClick={() => select(r.version)}
          >
            {r.version}
          </button>
        ))}
        {showOlder && (
          <button type="button" role="tab" aria-selected={selected === EARLIER} onClick={() => select(EARLIER)}>
            Earlier
          </button>
        )}
        {hasOlder && (
          <button type="button" className="docs-release-more" onClick={() => setShowOlder((v) => !v)}>
            {showOlder ? "Show fewer" : "Older versions"}
          </button>
        )}
      </div>

      {RELEASES.map((r) => (
        <section key={r.version} className="docs-release" data-off={selected !== r.version ? "" : undefined} data-release>
          <h2 id={releaseAnchor(r.version)}>
            {r.version}
            <span className="docs-release-date">{formatDate(r.date)}</span>
          </h2>
          {r.highlights && <p className="docs-lead-sm">{r.highlights}</p>}
          <Group title="New" items={r.new} />
          <Group title="Improved" items={r.improved} />
          <Group title="Fixed" items={r.fixed} />
          <Group title="Coming next" items={r.comingNext} />
        </section>
      ))}

      <section className="docs-release" data-off={selected !== EARLIER ? "" : undefined} data-release>
        <h2 id={EARLIER}>{EARLIER_DEVELOPMENT.title}</h2>
        <p className="docs-lead-sm">{EARLIER_DEVELOPMENT.intro}</p>
        <ul>
          {EARLIER_DEVELOPMENT.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
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
