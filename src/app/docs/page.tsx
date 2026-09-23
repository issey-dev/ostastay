import type { Metadata } from "next"
import { Cards, DocTitle } from "./components"
import { OPENAPI_URL, PDF_URL } from "./nav"

export const metadata: Metadata = { title: "Documentation" }

export default function DocsHome() {
  return (
    <>
      <DocTitle
        title="Uppsolut Stay documentation"
        lead="Connect a property's own website to Uppsolut Stay: show live availability and prices, and take bookings for rooms, excursions and spa treatments straight into the property's system."
      />
      <h2 id="developers">For web developers</h2>
      <Cards
        items={[
          { href: "/docs/api-integration", title: "Booking API overview", body: "What the API does, how a booking flows, and the modules it covers." },
          { href: "/docs/api-integration/getting-started", title: "Getting started", body: "Your key, its scopes, and the first calls to make." },
          { href: "/docs/api-integration/excursions", title: "Excursions", body: "Departures with live seats, holds and instant bookings." },
          { href: "/docs/api-integration/spa", title: "Spa", body: "Free times, therapist preferences, holds and bookings." },
          { href: "/docs/api-integration/rooms", title: "Rooms", body: "Availability calendar, quotes and room bookings." },
          { href: "/docs/api-integration/webhooks", title: "Webhooks", body: "Hear about changes the property makes to a booking." },
        ]}
      />
      <h2 id="properties">For properties</h2>
      <Cards
        items={[
          { href: "/docs/guides/online-booking-setup", title: "Setting up online booking", body: "For administrators: keys, what each property sells online, webhooks." },
          { href: "/docs/guides/front-desk", title: "Online bookings at the desk", body: "For front office and spa staff: where online bookings appear and how to handle them." },
        ]}
      />
      <h2 id="downloads">Downloads</h2>
      <ul>
        <li>
          <a href={OPENAPI_URL}>OpenAPI 3.1 description</a> — import into your API tool or generate a client.
        </li>
        <li>
          <a href={PDF_URL}>This guide as a PDF</a>.
        </li>
      </ul>
    </>
  )
}
