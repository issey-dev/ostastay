import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "Excursions" }

export default function Excursions() {
  return (
    <>
      <DocTitle
        title="Excursions"
        lead="The trips and activities you sell: what each costs, when it departs and how many seats it has. Available when your enterprise has the Excursions add-on."
      />
      <Where path="Hub › Controls › Excursions" who="Property Setup" />

      <H2>Before you start</H2>
      <ul>
        <li>A revenue <strong>charge code</strong> for excursions, e.g. 4001 Excursion Tours, in a group that reports as Other or Transport (<a href="/docs/configuration/property/charge-codes">step 3</a>). A new property has an empty Excursions group ready for it.</li>
        <li>An <strong>outlet</strong> for excursions (<a href="/docs/configuration/property/outlets">step 4</a>), linked on <strong>Charge Codes › Excursion outlet</strong>. No excursion can be booked until it is.</li>
      </ul>

      <H2>1. Add an excursion</H2>
      <p>Choose <strong>Add excursion</strong>, fill in the form and choose <strong>Create</strong>:</p>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Code / Name", "e.g. SNORK / Reef Snorkelling. Code 2–10 characters, unique."],
          ["Description", "Shown to guests, including on your website."],
          ["Charge code", "Where the revenue posts."],
          ["Cancellation cutoff (hours)", "Default 24. Until this many hours before departure a booking can be cancelled freely; after it, cancelling needs a manager."],
          ["Pricing mode", "Per adult / child / infant, or a Flat price per booking (e.g. a private charter)."],
          ["Pricing", "One or more date ranges with their prices. Leave the last range's end date empty to keep it running. A departure with no price range covering its date can't be booked."],
          ["Active", "Only active excursions can be booked."],
        ]}
      />
      <Shot name="prop-excursions" alt="The Excursions list: Reef Snorkelling and Sunset Dolphin Cruise with their charge code, pricing, current price and schedules." />

      <H2>2. Add a schedule</H2>
      <p>Choose <strong>Schedule</strong> on the excursion, fill in when it runs and choose <strong>Add schedule</strong>:</p>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Days", "The weekdays it runs, e.g. Mon, Wed, Fri."],
          ["Departure time / Meeting time", "Meeting time is optional."],
          ["Meeting point", "Optional, e.g. Main Jetty."],
          ["Capacity", "Seats per departure. Never exceeded: bookings stop when it is full."],
          ["Min. headcount to run", "Optional. The fewest guests the trip runs with. Staff see how close each departure is, and your website shows whether a departure is guaranteed. Nothing is cancelled automatically: the desk decides."],
        ]}
      />

      <p>
        Each schedule has an on/off switch: an inactive schedule is skipped when departures are generated, for example out of
        season. Deleting a schedule asks for confirmation and leaves departures already generated in place.
      </p>

      <H2>3. Generate departures</H2>
      <p>
        A schedule is a template. Bookings are made on <strong>departures</strong>, the actual trips on actual dates. Under{" "}
        <strong>Generate departures</strong>, pick a <strong>Through date</strong> and choose <strong>Generate</strong>: departures are created from today up to that date. It is safe
        to run again later to extend the calendar, and existing departures are never touched.
      </p>
      <Callout tone="warn">
        <p>
          Changing a schedule later does not change departures already generated. Change those individually from the Excursions
          screen on the dashboard.
        </p>
      </Callout>

      <H3>Selling online</H3>
      <p>
        To sell excursions on your own website, see <a href="/docs/configuration/property/online-booking">Online booking</a>.
      </p>
      <H3>Another property?</H3>
      <p>
        <strong>Copy from…</strong> copies excursions from another property, with their prices, charge code and schedules. Anything
        this property already has is skipped, never overwritten. Departures and bookings are never copied: generate this
        property&apos;s own departures afterwards. Copied excursions start unpublished online.
      </p>
      <Pager href="/docs/configuration/property/excursions" />
    </>
  )
}
