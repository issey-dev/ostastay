import type { Metadata } from "next"
import { Cards, DocTitle } from "./components"
import { DOC_AREAS, OPENAPI_URL } from "./nav"

export const metadata: Metadata = { title: "Documentation" }

export default function DocsHome() {
  return (
    <>
      <DocTitle
        title="Uppsolut Stay documentation"
        lead="Set up your enterprise and properties, run them day to day, and connect a property's own website to take bookings online."
      />

      <h2 id="configuration">Configuration: for administrators and property teams</h2>
      <p>Your property has just been provisioned. Start here: set up the enterprise, then each property, until it is ready for its first reservation.</p>
      <Cards
        items={[
          { href: "/docs/configuration", title: "Configuration overview", body: "How setup is organised, who does what, and the order to do it in." },
          { href: "/docs/configuration/getting-started", title: "Before you begin", body: "Signing in for the first time, finding your way around the Hub." },
          { href: "/docs/configuration/enterprise", title: "Enterprise setup", body: "People, roles, permissions, email and the settings shared by every property." },
          { href: "/docs/configuration/property", title: "Property setup", body: "Step by step from a new property to its first reservation." },
        ]}
      />

      <h2 id="operations">Operations: for property staff</h2>
      <Cards
        items={[
          { href: "/docs/operations/front-desk", title: "Online bookings at the desk", body: "Where bookings from the property's website appear and how to handle them." },
        ]}
      />

      <h2 id="developers">Booking API: for web developers</h2>
      <Cards
        items={[
          { href: "/docs/api", title: "Booking API overview", body: "What the API does, how a booking flows, and the modules it covers." },
          { href: "/docs/api/getting-started", title: "Getting started", body: "Your key, its scopes, and the first calls to make." },
          { href: "/docs/api/rooms", title: "Rooms", body: "Availability calendar, quotes and room bookings." },
          { href: "/docs/api/excursions", title: "Excursions", body: "Departures with live seats, holds and instant bookings." },
          { href: "/docs/api/spa", title: "Spa", body: "Free times, therapist preferences, holds and bookings." },
          { href: "/docs/api/webhooks", title: "Webhooks", body: "Hear about changes the property makes to a booking." },
        ]}
      />

      <h2 id="downloads">Downloads</h2>
      <ul>
        {DOC_AREAS.map((a) => (
          <li key={a.key}>
            <a href={a.pdf.url}>{a.pdf.title} (PDF)</a>
          </li>
        ))}
        <li>
          <a href={OPENAPI_URL}>Booking API: OpenAPI 3.1 description</a>. Import it into your API tool or generate a client.
        </li>
      </ul>
    </>
  )
}
