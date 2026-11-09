"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { EARLIER_DEVELOPMENT, RELEASES, majorOf, releaseAnchor } from "./releases"

// Release notes: one version at a time. The sidebar picks a MAJOR version (8.x, 7.x, ...,
// the ?major= query); the tab row lists that major's releases, ten at a time, with a button
// for the rest. Every section is still in the page (hidden on screen only) and all of them
// show in print, so the PDF built from this page keeps the full history.
const VISIBLE = 10
const EARLIER = "earlier"

const inMajor = (major: string) => RELEASES.filter((r) => majorOf(r.version) === major)

export function ReleaseTabs() {
  const majorParam = useSearchParams().get("major")
  const [selected, setSelected] = useState<string>(RELEASES[0].version)
  const [showOlder, setShowOlder] = useState(false)

  const currentMajor = selected === EARLIER ? EARLIER : majorOf(selected)

  function choose(key: string, older = false) {
    setSelected(key)
    setShowOlder(older)
    const anchor = key === EARLIER ? EARLIER : releaseAnchor(key)
    const major = key === EARLIER ? EARLIER : majorOf(key)
    window.history.replaceState(null, "", `?major=${major}#${anchor}`)
  }

  // A link like /docs/release-notes#v8-12-0 opens that version, once, on load.
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash === EARLIER) return setSelected(EARLIER)
    const r = RELEASES.find((x) => releaseAnchor(x.version) === hash)
    if (r) {
      setSelected(r.version)
      setShowOlder(inMajor(majorOf(r.version)).indexOf(r) >= VISIBLE)
    } else if (majorParam && majorParam !== EARLIER && inMajor(majorParam)[0]) {
      setSelected(inMajor(majorParam)[0].version)
    } else if (majorParam === EARLIER) setSelected(EARLIER)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The sidebar changed the major: open that major's newest release.
  useEffect(() => {
    if (!majorParam || majorParam === currentMajor) return
    setShowOlder(false)
    if (majorParam === EARLIER) setSelected(EARLIER)
    else if (inMajor(majorParam)[0]) setSelected(inMajor(majorParam)[0].version)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [majorParam])

  const versions = currentMajor === EARLIER ? [] : inMajor(currentMajor)
  const tabs = showOlder ? versions : versions.slice(0, VISIBLE)

  return (
    <>
      {versions.length > 0 && (
        <div role="tablist" aria-label={`Versions ${currentMajor}.x`} className="docs-release-index">
          {tabs.map((r) => (
            <button key={r.version} type="button" role="tab" aria-selected={selected === r.version} onClick={() => choose(r.version, showOlder)}>
              {r.version}
            </button>
          ))}
          {versions.length > VISIBLE && (
            <button type="button" className="docs-release-more" onClick={() => setShowOlder((v) => !v)}>
              {showOlder ? "Show fewer" : "Older versions"}
            </button>
          )}
        </div>
      )}

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
