import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Table } from "../../components"

export const metadata: Metadata = { title: "Property setup" }

export default function PropertySetup() {
  return (
    <>
      <DocTitle
        title="Property setup"
        lead="What a newly provisioned property already has, what you add, and the order to add it in."
      />

      <H2>Finding the property pages</H2>
      <p>
        In the Hub sidebar, under <strong>Property</strong>, choose <strong>Controls</strong>. The band at the top shows which
        property you are configuring; use its switcher to change property. Every setting on these pages applies to that property
        only.
      </p>
      <p>
        <strong>Controls</strong> in the sidebar also opens into a list of the property&apos;s sections, so you can go straight from
        one section to the next. Pages with three or more sections show links under the page title that jump to each one.
      </p>
      <Shot name="prop-controls" alt="The Controls page for Coral Bay Resort: cards for General, Rooms & Inventory, Reservations, Revenue, Finance, Charge Codes, Outlets, Excursions, Spa, Night Audit, Stationery, Online Booking, Green Tax and Sequences." />

      <H2>How saving works</H2>
      <ul>
        <li>
          A section with several fields has one <strong>Save</strong> at the bottom. It stays greyed out until you change something;
          beside it you see <strong>Unsaved changes</strong>, then <strong>Saved</strong> once it has gone through.
        </li>
        <li>
          A single switch or drop-down on its own saves as soon as you change it, and shows a brief <strong>Saved</strong> tick.
        </li>
        <li>
          In an add or edit form, choose <strong>Create</strong> for something new, or <strong>Save</strong> for a change.
        </li>
        <li>Deleting anything asks you to confirm first.</li>
      </ul>

      <H2>What a new property already has</H2>
      <Table
        head={["Already there", "Details"]}
        rows={[
          ["Business date", "Your go-live date. Night audit moves it forward each night."],
          ["Base Rate plan", "A locked rate plan (code BASE) with no prices yet. It is the fallback price for every room type."],
          ["System charge codes", "Accommodation (1000), cancellation and no-show fees, service charge (7000), GST (8000), Green Tax (8500), commission, deposit, payment and adjustment codes, already wired to post their taxes."],
          ["Posting defaults", "Room charges post to 1000, Green Tax to 8500, commission to 9100."],
          ["Tax rates", "Maldives defaults: GST 17%, service charge 10%, Green Tax 12 per adult and 6 per child per night. Prices include taxes."],
          ["Fee rules", "A cancellation and a no-show fee, both switched off at zero."],
          ["Night audit", "Manual (not scheduled), no-shows marked at the arrival night's audit."],
          ["Documents", "Registration card and eRegistration on (72-hour links), detailed folios."],
        ]}
      />
      <p>
        <strong>Everything else starts empty:</strong> room types and rooms, prices, revenue charge codes (food, beverage, transport
        and so on), payment methods, outlets, meal plans, allocations, lists, and the wording on documents.
      </p>

      <H2>The setup steps</H2>
      <p>Work through them in this order. Each step only uses what the steps before it created.</p>
      <Table
        head={["Step", "Page in the Hub", "You set up", "Needs"]}
        rows={[
          [<a key="1" href="/docs/configuration/property/general">1. General</a>, "General", "Name, address, logo, times, colour, idle sign-out", "—"],
          [<a key="2" href="/docs/configuration/property/finance">2. Tax & payments</a>, "Finance", "Tax rates, custom taxes, payment methods, cashier defaults, fee rules", "—"],
          [<a key="3" href="/docs/configuration/property/charge-codes">3. Charge codes</a>, "Charge Codes", "Your revenue codes and what they post", "Custom taxes (step 2)"],
          [<a key="4" href="/docs/configuration/property/outlets">4. Outlets</a>, "Outlets", "Restaurants, bars, shops, spa and excursion desks", "Charge codes"],
          [<a key="5" href="/docs/configuration/property/rooms">5. Rooms & inventory</a>, "Rooms & Inventory", "Room features, room types, buildings, floors, rooms", "—"],
          [<a key="6" href="/docs/configuration/property/rates">6. Rates & packages</a>, "Revenue (Hub and dashboard)", "Prices, rate plans, allocations, meal plans", "Room types, charge codes"],
          [<a key="7" href="/docs/configuration/property/reservations">7. Reservations & numbering</a>, "Reservations, Sequences", "Booking number format, lists, starting numbers", "—"],
          [<a key="8" href="/docs/configuration/property/night-audit">8. Night audit</a>, "Night Audit", "Business date, nightly postings, no-shows, schedule", "Fee rules (step 2)"],
          [<a key="9" href="/docs/configuration/property/stationery">9. Stationery</a>, "Stationery", "Invoice, receipt, letter and registration-card wording", "General details"],
        ]}
      />
      <p>Then, if they apply to you:</p>
      <Table
        head={["Optional", "When"]}
        rows={[
          [<a key="e" href="/docs/configuration/property/excursions">Excursions</a>, "Your enterprise has the Excursions add-on."],
          [<a key="s" href="/docs/configuration/property/spa">Spa</a>, "Your enterprise has the Spa add-on."],
          [<a key="o" href="/docs/configuration/property/online-booking">Online booking</a>, "Your own website takes bookings."],
          [<a key="c" href="/docs/configuration/property/channel-manager">Channel manager</a>, "You sell through online travel agencies and Uppsolut has connected your channel manager."],
          [<a key="g" href="/docs/configuration/property/green-tax">Green Tax register</a>, "Maldives properties: nothing to set up, but read it before your first month-end."],
        ]}
      />
      <Callout title="Setting up a second property?">
        <p>
          Most property pages have a <strong>Copy from…</strong> button. It copies from another active property of your enterprise:
          room types and room-feature lists, reservation lists, meal plans, tax profiles, payment methods, charge codes, outlets and
          stationery. Items the property already has are skipped, never overwritten. Rooms, prices and numbering are never copied:
          they are physical or specific to each property.
        </p>
      </Callout>
      <Pager href="/docs/configuration/property" />
    </>
  )
}
