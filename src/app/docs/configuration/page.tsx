import type { Metadata } from "next"
import { Callout, Cards, DocTitle, H2, Pager, Table } from "../components"

export const metadata: Metadata = { title: "Configuration guide" }

export default function ConfigurationOverview() {
  return (
    <>
      <DocTitle
        title="Configuration guide"
        lead="Your enterprise and first property have been provisioned. This guide takes you from there to a property that is ready for its first reservation."
      />

      <H2>Who does what</H2>
      <Table
        head={["Who", "Does"]}
        rows={[
          [
            <strong key="u">Uppsolut</strong>,
            "Creates your enterprise and its first property, your licence (how many properties and rooms), the add-ons you bought (Spa, Excursions), the channel-manager connection, and your first administrator account. Approves properties you add later.",
          ],
          [
            <strong key="a">Your administrator</strong>,
            "Signs in first, sets up the enterprise: staff accounts and roles, email, guest lists, Booking API keys. Usually also leads the property setup.",
          ],
          [
            <strong key="p">Your property team</strong>,
            "Configures each property: its details, taxes, charge codes, outlets, rooms, rates, night audit and documents. Front office, finance and revenue each own their part.",
          ],
        ]}
      />

      <H2>Two areas: enterprise and property</H2>
      <p>
        All setup happens in the <strong>Hub</strong>, the setup and administration side of Uppsolut Stay. The Hub has two areas, and
        every setting lives in exactly one of them:
      </p>
      <ul>
        <li>
          <strong>Enterprise</strong>: things shared by all your properties. People and roles, sessions, the email account, guest
          lists (a guest profile is shared by every property), Booking API keys and support access.
        </li>
        <li>
          <strong>Property</strong>: everything else, one property at a time. A property&apos;s taxes, charge codes, rooms, rates
          and documents are its own, so two properties can work differently.
        </li>
      </ul>
      <Callout title="Several properties?">
        <p>
          Set up your first property completely, then use <strong>Copy from…</strong> on the property pages (room types, lists,
          meal plans, charge codes, outlets, tax profiles, payment methods, stationery) to bring its setup into the next one. Copying
          only adds what is missing and never overwrites.
        </p>
      </Callout>

      <H2>The order to work in</H2>
      <p>Some settings depend on others, for example rooms need room types and rates need charge codes. This order avoids going back:</p>
      <ol className="docs-steps">
        <li><strong>Sign in and set your password</strong> (<a href="/docs/configuration/getting-started">Before you begin</a>).</li>
        <li><strong>Enterprise:</strong> add your staff and roles, set up email, fill the guest lists (<a href="/docs/configuration/enterprise">Enterprise setup</a>).</li>
        <li><strong>Property, steps 1–9:</strong> general details, tax and payments, charge codes, outlets, rooms, rates, numbering, night audit, stationery (<a href="/docs/configuration/property">Property setup</a>).</li>
        <li><strong>Add-ons and channels</strong> if you have them: excursions, spa, online booking, channel manager.</li>
        <li><strong>Go-live checklist</strong>: confirm everything before the first real guest (<a href="/docs/configuration/go-live">Go-live checklist</a>).</li>
      </ol>
      <p>
        A small property with a clear rate structure can be set up in a day. Allow more time when you have many room types, rate plans
        or outlets. The Hub&apos;s <strong>Overview</strong> page tells you, at any point, what is still missing.
      </p>

      <Cards
        items={[
          { href: "/docs/configuration/getting-started", title: "Before you begin →", body: "First sign-in, your password, and the Hub." },
          { href: "/docs/configuration/property", title: "Property setup →", body: "What a new property already has, and the setup steps." },
        ]}
      />
      <Pager href="/docs/configuration" />
    </>
  )
}
