import type { Metadata } from "next"
import { Callout, Cards, DocTitle, H2, Pager, Table } from "../components"
import { EXAMPLE_BASE } from "../nav"

export const metadata: Metadata = { title: "Booking API overview" }

export default function Overview() {
  return (
    <>
      <DocTitle
        title="Booking API"
        lead="One API, one key: a property's own website shows live availability and prices and books rooms, excursions and spa treatments directly into Uppsolut Stay."
      />

      <H2>What you can build</H2>
      <p>A website on the Booking API is a front for one property, or several properties of the same group behind one portal. Typically:</p>
      <ul>
        <li><strong>Property pages</strong> — description, photos, location, contact details, room types and facilities.</li>
        <li><strong>A room booking page</strong> — dates and guests, what is free and what it costs, minimal guest details, confirm.</li>
        <li><strong>An excursions page</strong> — upcoming departures with seats left, then book for a party.</li>
        <li><strong>A spa page</strong> — treatments by category, free start times on a day, then book, alone or as a couple.</li>
        <li><strong>A &quot;my booking&quot; page</strong> — the live status of a booking, and self-cancellation where allowed.</li>
      </ul>
      <p>
        Everything the site shows comes from Uppsolut Stay, so the property maintains one set of facts: the rates, capacity and
        closures the desk sets are exactly what the site sells, and a booking made on the site is at the desk immediately.
      </p>

      <H2>Modules and scopes</H2>
      <p>
        A key is enabled for one or more <strong>modules</strong>. Which ones a property sells online, and which of its
        excursions and treatments are published, is the property&apos;s choice in its administration area — your site reads it
        rather than hard-coding it.
      </p>
      <Table
        head={["Module", "Scope", "What it covers"]}
        rows={[
          ["Rooms", <code key="r">ROOMS</code>, "Availability calendar, stay quotes, room bookings, booking lookup."],
          ["Excursions", <code key="e">EXCURSIONS</code>, "Excursion catalogue, departures with live seats, quotes, holds, bookings."],
          ["Spa", <code key="s">SPA</code>, "Treatment catalogue, free start times, quotes, holds, bookings."],
        ]}
      />
      <p>
        <code>GET /properties/&#123;id&#125;</code> returns a <code>modules</code> block saying which modules your key can book at that
        property right now. Show a section only when it is enabled.
      </p>

      <H2>How a booking flows</H2>
      <ol className="docs-steps">
        <li><strong>Browse.</strong> Read the catalogue and live availability: nights for rooms, departures for excursions, start times for spa.</li>
        <li><strong>Price.</strong> Ask for a quote. It is the authoritative total, computed by the same code the property bills with — taxes, service charge and levies included. Never add prices up yourself.</li>
        <li><strong>Hold (excursions and spa).</strong> If your site takes payment before booking, hold the seats or the time slot first. The hold keeps them for a few minutes while the guest pays.</li>
        <li><strong>Book.</strong> Confirm with a fresh <code>Idempotency-Key</code>. The booking is instant: confirmed if the space is there, refused otherwise. Tell us whether the guest has paid.</li>
        <li><strong>Confirm to the guest.</strong> Show the reference and email it. Uppsolut Stay does not email guests for online bookings.</li>
        <li><strong>Afterwards.</strong> Look bookings up by reference and email, let guests cancel before the deadline, and receive webhooks when the property changes something.</li>
      </ol>

      <Callout title="Nothing to synchronise">
        <p>
          Your site holds no copy of availability or prices. Every call reads the live state of the property. Two guests racing for
          the last seat are resolved at booking time — the site is built to handle a <code>SOLD_OUT</code> answer gracefully and can
          never overbook.
        </p>
      </Callout>

      <H2>Payment</H2>
      <p>
        The API takes no payment. Your site either takes payment itself (through your own provider) and sends the booking as{" "}
        <code>PAID</code> with your payment reference, or sends it as <code>UNPAID</code> for the guest to pay at the property. A paid
        booking is settled on the guest&apos;s bill automatically, so the desk sees it as paid.
      </p>

      <H2>Base URL</H2>
      <p>
        Every path in this guide is relative to <code>{EXAMPLE_BASE}</code> — use the address your property signs in at, with{" "}
        <code>/api/website/v1</code> after it.
      </p>

      <Cards
        items={[
          { href: "/docs/api-integration/getting-started", title: "Getting started →", body: "Get a key and make your first calls." },
          { href: "/docs/api-integration/errors", title: "Error codes →", body: "Every code the API answers with." },
        ]}
      />
      <Pager href="/docs/api-integration" />
    </>
  )
}
