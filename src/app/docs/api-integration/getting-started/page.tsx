import type { Metadata } from "next"
import { Callout, CodeBlock, DocTitle, H2, Pager } from "../../components"
import { EXAMPLE_BASE } from "../../nav"

export const metadata: Metadata = { title: "Getting started" }

export default function GettingStarted() {
  return (
    <>
      <DocTitle title="Getting started" lead="From a key to your first booking in a few calls." />

      <H2>1. Get a key from the property</H2>
      <p>
        The property&apos;s administrator creates your key in their administration area and ticks what it may use — Rooms,
        Excursions, Spa — and whether it covers one property or all of the group&apos;s properties. They send you three values; keep them as <strong>server-side secrets</strong>{" "}
        (environment variables or a secrets manager), never in page source or a public repository:
      </p>
      <CodeBlock
        lang="env"
        code={`
UPPSOLUT_API_BASE=${EXAMPLE_BASE}
UPPSOLUT_API_KEY=wsk_…
UPPSOLUT_PROPERTY_ID=…   # from GET /properties
`}
      />
      <p>Keys start with <code>wsk_</code>. The property can rotate or revoke a key at any time; a rotated key stops working at once.</p>

      <H2>2. List your properties</H2>
      <CodeBlock
        lang="shell"
        code={`
curl -H "Authorization: Bearer $UPPSOLUT_API_KEY" "$UPPSOLUT_API_BASE/properties"
`}
      />
      <p>This lists exactly the properties your key covers, with their ids.</p>

      <H2>3. Read the property and see what is live</H2>
      <CodeBlock
        lang="shell"
        code={`
curl -H "Authorization: Bearer $UPPSOLUT_API_KEY" "$UPPSOLUT_API_BASE/properties/$UPPSOLUT_PROPERTY_ID"
`}
      />
      <CodeBlock
        lang="json"
        code={`
{
  "property": {
    "id": "…",
    "name": "Coral Bay Resort",
    "businessDate": "2026-10-01",
    "…": "…",
    "modules": {
      "rooms":      { "enabled": true, "code": null, "reason": null },
      "excursions": { "enabled": true, "code": null, "reason": null },
      "spa":        { "enabled": false, "code": "NOT_SOLD_ONLINE", "reason": "The property does not sell this online." }
    }
  }
}
`}
      />
      <p>
        Render a section of your site only when its module is <code>enabled</code>. Re-read this rather than hard-coding it: a
        property can switch a module on or off at any time and your site then follows without a code change.
      </p>

      <H2>4. A small client</H2>
      <CodeBlock
        lang="javascript (node 18+)"
        code={`
const BASE = process.env.UPPSOLUT_API_BASE;
const KEY = process.env.UPPSOLUT_API_KEY;

export async function api(path, init = {}) {
  const res = await fetch(\`\${BASE}\${path}\`, {
    ...init,
    headers: { Authorization: \`Bearer \${KEY}\`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error), { code: body.code, status: res.status, details: body.details });
  return body;
}
`}
      />

      <H2>5. Book an excursion, end to end</H2>
      <CodeBlock
        lang="javascript"
        code={`
const P = process.env.UPPSOLUT_PROPERTY_ID;

// What is on sale, and the departures in the next two weeks
const { excursions } = await api(\`/properties/\${P}/excursions\`);
const { departures } = await api(\`/properties/\${P}/excursions/departures?from=2026-10-01&to=2026-10-14\`);
const departure = departures.find((d) => d.bookable && d.seatsLeft >= 3);

// Hold the seats while the guest pays on your site
const { hold } = await api(\`/properties/\${P}/excursions/holds\`, {
  method: "POST",
  body: JSON.stringify({ departureId: departure.id, adults: 2, children: 1 }),
});
// … take payment for hold.quote.totals.grandTotal with your own provider …

// Book — instant
const { booking } = await api(\`/properties/\${P}/excursions/bookings\`, {
  method: "POST",
  headers: { "Idempotency-Key": crypto.randomUUID() },
  body: JSON.stringify({
    holdId: hold.holdId,
    guest: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    payment: { status: "PAID", provider: "YourProvider", reference: "pay_123", amount: hold.quote.totals.grandTotal },
    expectedTotal: hold.quote.totals.grandTotal,
  }),
});
console.log(booking.reference); // e.g. EXC-7K3QX9MD — show and email it to the guest
`}
      />
      <Callout title="Server to server">
        <p>
          Make these calls from your website&apos;s server, never from the visitor&apos;s browser. Excursion and spa bookings are
          refused from browser-enabled keys — see <a href="/docs/api-integration/authentication">Authentication</a>.
        </p>
      </Callout>
      <Pager href="/docs/api-integration/getting-started" />
    </>
  )
}
