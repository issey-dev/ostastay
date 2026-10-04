import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "Transportation" }

export default function TransportationSetup() {
  return (
    <>
      <DocTitle
        title="Transportation"
        lead="Guest transfers — the airport meet-and-greet, the speedboat or seaplane to the island, and island-to-island trips. Set up once per property: what you travel by, where, with whom, and what it costs."
      />
      <Where path="Hub › Controls › Transportation" who="Property Setup" />

      <Callout>
        <p>
          Everything on this page belongs to <strong>this property only</strong>. Another property of the same group sets up its own
          routes, boats and prices; nothing is shared.
        </p>
      </Callout>

      <H2>Before you start</H2>
      <ul>
        <li>
          A revenue <strong>charge code</strong> for transfers, in a group that reports as Transport (<a href="/docs/configuration/property/charge-codes">step 3</a>).
          If the property has none, <strong>Load defaults</strong> below creates one called Transportation.
        </li>
        <li>Staff who meet guests at the airport need a user account to be chosen as an <strong>airport rep</strong> (<a href="/docs/configuration/enterprise/people">People</a>).</li>
      </ul>

      <H2>1. Switch it on</H2>
      <p>In the <strong>Module</strong> section:</p>
      <Table
        head={["Setting", "What it does"]}
        rows={[
          ["Transportation is on", "Shows Transportation in the dashboard menu, the Transportation card on reservations, and lets Night Audit post transfer charges. Off: none of these, and nothing is posted."],
          ["Time to allow around a flight", "Default 60 minutes. A boat leaving sooner than this after a flight lands, or reaching the airport later than this before take-off, is marked Needs attention. It only warns — nothing is ever refused."],
          ["Default charge code / Default tax", "What a new rate starts with. Each rate can still choose its own."],
          ["A provider must be assigned…", "When on, a transfer can't be marked Assigned, and a departure can't be Confirmed, until a provider is chosen."],
        ]}
      />
      <p>
        <strong>Load defaults</strong> adds the usual Maldivian set-up — Speedboat, Seaplane, Domestic flight, Public ferry and Car / van, Velana
        International Airport (MLE) and the property itself as locations, and a Transportation charge code. It skips anything you already
        have.
      </p>
      <Shot name="prop-transportation" alt="The Transportation setup page: the module switch and defaults, then transport types, locations, routes, providers, vessels and rates." />

      <H2>2. Transport types</H2>
      <p>
        How guests travel: a code, a name and a mode (Speedboat, Seaplane, Domestic flight, Ferry, Land, Other). Turn on <strong>Needs flight
        details</strong> for a seaplane or domestic flight: every transfer using it then asks for the airline, flight number and time.
      </p>

      <H2>3. Locations</H2>
      <p>Every place a transfer starts or ends: the airport, the seaplane platform, jetties, islands, resorts and guesthouses. Notes are a good place for the meeting point.</p>

      <H2>4. Routes</H2>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Code / Name", "e.g. MLE-SPB / Airport – resort by speedboat."],
          ["From / To", "Two of your locations. For a route used both ways, enter it the arrival way round (airport → property); a drop-off travels it in reverse automatically."],
          ["Transport type", "What it runs with."],
          ["Category", "Airport transfer (each transfer shows the flight) or Local transfer (island to island, no flight)."],
          ["Used for", "Pickups, drop-offs or both."],
          ["Duration", "Minutes. Counted when checking a drop-off reaches the airport in time."],
          ["Default departure times", "e.g. 10:00, 14:00, 17:00. Suggested when booking, and used to create a day's departures in one click. Never binding."],
          ["Instructions", "Shown on each transfer: where to meet, luggage rules."],
        ]}
      />

      <H2>5. Providers and vessels</H2>
      <p>
        A <strong>provider</strong> is who runs the transfer: your own fleet (Own) or an operator you book (Third party), with a contact and
        phone. Under it, add each <strong>boat, seaplane or vehicle</strong> with its seats. Seats are used to warn when a departure has more
        passengers than fit — a warning only.
      </p>

      <H2>6. Rates</H2>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Route", "The route this price is for. A route with no rate is complimentary."],
          ["Applies to", "Pickups, drop-offs or both."],
          ["Pricing", "Per person (adult, child and infant prices, with the ages that count as a child), Per vehicle (price × vehicles) or Per trip (one price per transfer)."],
          ["Valid from / to", "Optional. Leave empty for a year-round price; add a dated rate for a season."],
          ["Only for transport type / provider", "Optional. A seaplane operator's own price, for example."],
          ["Charge code / Tax", "Where the revenue posts, and its tax: as the charge code says, the property's default (Service Charge + GST), or a custom tax profile."],
          ["Billable", "Off = shown but never charged (included in a package)."],
          ["Enabled", "Off = not used for new transfers."],
        ]}
      />
      <p>
        Prices are entered the way every price at the property is — including or excluding tax as set under Finance. When a transfer is
        booked the <strong>most specific</strong> enabled rate is used: a provider&apos;s own rate first, then a transport type&apos;s, then
        one for exactly that direction, then the newest season.
      </p>

      <H2>7. Who can do what</H2>
      <p>Roles are set on <a href="/docs/configuration/enterprise/people">People</a>, under the Transportation row:</p>
      <Table
        head={["Permission", "Means"]}
        rows={[
          ["View", "See the board, the airport rep and dispatch views, and export the report."],
          ["Create", "Book and edit transfers."],
          ["Update", "Manage departures: create them, put guests on and off, change their status."],
          ["Delete", "Billing: post or waive a transfer charge by hand, post a fee, set a price by hand."],
        ]}
      />
      <p>Voiding a posted transfer charge also needs Cashiering (update), as for any folio correction. This page itself needs Property Setup.</p>

      <H3>Deactivate, don&apos;t delete</H3>
      <p>
        Anything already used by a transfer, rate or departure can&apos;t be deleted — use the deactivate button. Deactivated rows stay on
        old transfers and reports but aren&apos;t offered for new ones.
      </p>
      <H3>Using it</H3>
      <p>
        The day-to-day side — transfers, departures, the board and billing — is in the <a href="/docs/operations/transportation">Transportation operations guide</a>.
      </p>
      <Pager href="/docs/configuration/property/transportation" />
    </>
  )
}
