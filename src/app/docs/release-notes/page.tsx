import { Suspense } from "react"
import type { Metadata } from "next"
import { DocTitle, Pager } from "../components"
import { RELEASES } from "./releases"
import { ReleaseTabs } from "./release-tabs"

export const metadata: Metadata = { title: "Release notes" }

// One released version at a time, newest first — what it added, improved and fixed. The entries
// live in ./releases.ts; add the new version at the top when you tag a release.
export default function ReleaseNotes() {
  const latest = RELEASES[0]
  return (
    <>
      <DocTitle
        title="Release notes"
        lead={`What each version of Uppsolut Stay added, improved and fixed. The current version is ${latest.version}.`}
      />

      <Suspense>
        <ReleaseTabs />
      </Suspense>
      <Pager href="/docs/release-notes" />
    </>
  )
}
