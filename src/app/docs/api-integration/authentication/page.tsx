import type { Metadata } from "next"
import { Callout, CodeBlock, DocTitle, H2, H3, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Authentication & limits" }

export default function Authentication() {
  return (
    <>
      <DocTitle title="Authentication, limits and conventions" lead="How to send your key, where it may live, how much you may call, and the conventions every endpoint follows." />

      <H2>Sending the key</H2>
      <p>Send the key on every request, in the <code>Authorization</code> header (preferred) or in <code>X-Api-Key</code>. Never in a URL.</p>
      <CodeBlock lang="http" code={`Authorization: Bearer wsk_…`} />
      <Table
        head={["Status", "Code", "Meaning"]}
        rows={[
          ["401", <code key="a">MISSING_API_KEY</code>, "No key header."],
          ["401", <code key="b">INVALID_API_KEY</code>, "Unknown, revoked or expired key — deliberately the same answer for all three."],
          ["403", <code key="c">SCOPE_NOT_GRANTED</code>, "The key is valid but not enabled for this module. Ask the property to tick it on your key."],
        ]}
      />

      <H2>Where the key lives</H2>
      <p>A key can create bookings in the property&apos;s system. Treat it like a database password.</p>
      <H3>Server to server (recommended)</H3>
      <p>
        Your website&apos;s backend calls the API and your pages call your backend. Any stack works — a Next.js or Nuxt server route,
        a PHP controller, a serverless function. The key never reaches a browser.
      </p>
      <H3>From the browser (static sites only)</H3>
      <p>
        The property can add your site&apos;s origin (e.g. <code>https://www.example.com</code>) to the key; the API then answers
        CORS for that origin. Anyone who reads your page source can then read the key.
      </p>
      <Callout tone="warn" title="Browser keys cannot book excursions or spa">
        <p>
          An excursion or spa booking carries your site&apos;s statement that the guest has paid, so it must come from your server.
          A key with browser origins may read the excursion and spa catalogues and availability; holds, bookings and cancellations
          answer <code>403 SERVER_KEY_REQUIRED</code>.
        </p>
      </Callout>

      <H2>Rate limits</H2>
      <Table
        head={["Requests, per key", "Limit per minute"]}
        rows={[
          [<span key="g"><code>GET</code> — catalogues, availability, lookups</span>, "120"],
          [<span key="p"><code>POST</code> — quotes, holds, bookings, cancellations</span>, "20"],
        ]}
      />
      <p>
        Every response carries <code>RateLimit-Limit</code>, <code>RateLimit-Remaining</code> and <code>RateLimit-Reset</code>{" "}
        (seconds until the window resets). Past the limit you get <code>429 RATE_LIMITED</code> with <code>Retry-After</code>: wait that
        long and retry. A booking retried after a 429 must reuse its <code>Idempotency-Key</code>.
      </p>
      <p>
        Requests with a missing or wrong key are counted per calling address: after 30 in a minute that address gets 429 instead of
        401 until the window resets. Check the key in your configuration rather than retrying. A website may hold at most 50 live
        holds at a time (<code>429 TOO_MANY_HOLDS</code>).
      </p>
      <p>To stay well inside the limits: search once per visitor search rather than once per day of a calendar, cache property details and catalogues for a few minutes, and never poll.</p>

      <H2>Conventions</H2>
      <ul>
        <li><strong>JSON in, JSON out</strong>, UTF-8.</li>
        <li><strong>Dates</strong> are <code>YYYY-MM-DD</code> calendar days in the property&apos;s time zone; times are <code>HH:MM</code>, 24-hour, property local.</li>
        <li><strong>Money</strong> is a plain number in the property&apos;s currency.</li>
        <li><strong>Today</strong> is the property&apos;s <code>businessDate</code> (from <code>GET /properties/&#123;id&#125;</code>), which only moves when the desk closes the day. Build date pickers off it, not the visitor&apos;s clock.</li>
        <li><strong>No caching:</strong> every response is <code>Cache-Control: no-store</code>. Availability is live.</li>
        <li><strong>Versioning:</strong> the <code>v1</code> path segment. Fields may be added to responses at any time; nothing is removed or renamed within v1. Ignore fields you do not know.</li>
        <li><strong>Errors</strong> are JSON with a stable <code>code</code> to switch on, a human <code>error</code>, and, for validation, <code>details</code> keyed by field. See <a href="/docs/api-integration/errors">Error codes</a>.</li>
      </ul>
      <CodeBlock lang="json" code={`{ "error": "Invalid request.", "code": "VALIDATION", "details": { "guest.email": "A valid email is required" } }`} />

      <H2>Idempotency</H2>
      <p>
        Every booking call needs an <code>Idempotency-Key</code> header: a fresh value (a UUID) per booking attempt. If a request
        times out or fails with a 5xx, retry with the <strong>same</strong> key: you get the same booking back (<code>200</code>,{" "}
        <code>replayed: true</code>), never a second one. Keys are scoped to your API key.
      </p>
      <Pager href="/docs/api-integration/authentication" />
    </>
  )
}
