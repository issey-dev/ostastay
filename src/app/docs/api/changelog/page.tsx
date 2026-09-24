import type { Metadata } from "next"
import { DocTitle, H2, Pager } from "../../components"

export const metadata: Metadata = { title: "Changelog" }

// Additive changes only within v1 — see Authentication → Conventions → Versioning.
export default function Changelog() {
  return (
    <>
      <DocTitle title="Changelog" lead="Everything here is additive: nothing is removed or renamed within v1." />

      <H2 id="2026-09-24">September 2026 — documentation: new address, dates for Excursions and Spa</H2>
      <ul>
        <li>
          This guide moved from <code>/docs/api-integration</code> to <code>/docs/api</code>. Old links redirect permanently, so
          nothing breaks, but update your bookmarks. No change to the API itself.
        </li>
        <li>
          Clarified what &quot;today&quot; means. Rooms keep using the property&apos;s <code>businessDate</code>; Excursions and Spa run on
          the actual date in the property&apos;s time zone, so activity date pickers should start at whichever of the two is later. See{" "}
          <a href="/docs/api/authentication#conventions">Conventions</a>. No change to the API itself.
        </li>
      </ul>

      <H2 id="2026-09-23">September 2026 — Excursions, Spa, webhooks</H2>
      <ul>
        <li><strong>Excursions</strong>: catalogue, departures with live seats, quotes, holds, instant bookings.</li>
        <li><strong>Spa</strong>: treatments, free times with optional therapist gender, quotes, holds, instant bookings for one guest or a couple.</li>
        <li><strong>Managing bookings</strong>: <code>GET /activity-bookings/&#123;reference&#125;</code> and guest self-cancel.</li>
        <li><strong>Webhooks</strong>: signed notifications when the property changes a booking.</li>
        <li><strong>Scopes</strong>: keys are enabled for <code>ROOMS</code>, <code>EXCURSIONS</code> and/or <code>SPA</code>. Existing keys are <code>ROOMS</code> keys. New <code>403 SCOPE_NOT_GRANTED</code>.</li>
        <li><strong>Modules</strong>: <code>GET /properties/&#123;id&#125;</code> gains a <code>modules</code> block.</li>
        <li><strong>Rate limits</strong>: per-key limits, <code>429 RATE_LIMITED</code> with <code>RateLimit-*</code> and <code>Retry-After</code> headers.</li>
      </ul>

      <H2 id="2026-09-07">September 2026 — meal plans and extras</H2>
      <ul>
        <li>Rooms: guests may choose a meal plan and add paid extras where the property offers them.</li>
      </ul>

      <H2 id="2026-09-06">September 2026 — first release</H2>
      <ul>
        <li>Rooms: properties, property details, availability, quote, bookings, booking lookup.</li>
      </ul>
      <Pager href="/docs/api/changelog" />
    </>
  )
}
