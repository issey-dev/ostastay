import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "6. Rates & packages" }

export default function Rates() {
  return (
    <>
      <DocTitle
        title="Step 6 — Rates & packages"
        lead="What a night costs, on which rate plans, and what is included: breakfast, dinner, transfers. Your revenue manager should own this step."
      />
      <Callout title="Two places">
        <p>
          Rates are set up in two places. In the Hub, <strong>Controls › Revenue</strong> has the Allocation Calculation choice and Meal
          Plans. Rate plans, allocations and prices are day-to-day revenue work, so they are on the property dashboard under{" "}
          <strong>Finance › Revenue</strong>. Both need the <strong>Revenue</strong> permission to save.
        </p>
      </Callout>

      <H2>The building blocks</H2>
      <Table
        head={["Block", "What it is", "Example"]}
        rows={[
          ["Price calendar", "A price per room type, per night, per rate plan, plus extra-adult and extra-child prices.", "Beach Villa, 1 Dec, BAR: 370"],
          ["Rate plan", "A way of selling a room, with its own prices (or prices derived from another plan).", "BAR, Non-Refundable, Corporate"],
          ["Base Rate", "The locked rate plan every property has. Its prices are the fallback for every plan.", "BASE"],
          ["Allocation", "A priced, per-person extra that posts at night audit.", "Breakfast 25 per adult, 12 per child"],
          ["Meal plan", "A named bundle of allocations the guest chooses.", "Half Board = Breakfast + Dinner"],
        ]}
      />

      <H2>1. Price the Base Rate</H2>
      <Where path="Dashboard › Finance › Revenue › Rate Seasons" who="Revenue" />
      <p>
        Do this first. When a night has no price on the booked plan, night audit falls back to the Base Rate, and when the Base Rate
        has no price either, the night posts <strong>zero</strong>. Price the Base Rate for at least a year ahead.
      </p>
      <Shot name="prop-rate-seasons" alt="The Rate Seasons tab: choose a rate plan, a season's dates and prices, and the room types, with a review panel." />
      <ol className="docs-steps">
        <li><strong>Select Target Rate Plan</strong>: Base Rate.</li>
        <li><strong>Season</strong>: the first and last night (both get the price). <strong>Daily Price</strong>: per room per night, at the room type&apos;s base occupancy. Optionally the <strong>Extra Adult</strong> and <strong>Extra Child Price</strong>.</li>
        <li><strong>Apply to Room Types</strong>: tick the room types this price is for.</li>
        <li>Check the <strong>Review</strong> panel and choose <strong>Push Prices to Calendar</strong>.</li>
      </ol>
      <p>
        Repeat for each season and each group of room types that shares a price. A push overwrites prices already set for those
        dates, so enter seasons from the broadest to the most specific: the whole year first, then peak weeks on top.
      </p>
      <p>
        To check or fine-tune, open the plan&apos;s <strong>Calendar</strong> from the Rate Plans tab: a month view per room type,
        with a <strong>Bulk Update</strong> form for date ranges. Each day shows the price night audit will actually charge, marked{" "}
        <strong>Derived</strong>, <strong>Base + adj.</strong> or <strong>Base fallback</strong> when it doesn&apos;t come from the
        plan itself. <strong>No Rate</strong> means nothing is priced and the night would post zero.
      </p>

      <H2>2. Rate plans</H2>
      <Where path="Dashboard › Finance › Revenue › Rate Plans" who="Revenue" />
      <Shot name="prop-rate-plans" alt="The Rate Plan Hierarchy: BAR, Non-Refundable derived from BAR at -10%, a negotiated Corporate Rate, and the locked Base Rate." />
      <p>Choose <strong>New Rate Plan</strong>:</p>
      <Shot name="prop-rate-plan-dialog" alt="The Create New Rate Plan dialog: code, priority, name, description, accommodation charge code, derive-from settings, flags and package allocations." />
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Rate Code", "e.g. BAR. Unique at the property. BASE is reserved."],
          ["Priority", "Lower numbers are listed first when staff pick a rate."],
          ["Plan Name / Description", "What staff see, e.g. Best Available Rate."],
          ["Accommodation Charge Code", "Leave on the default (1000) unless finance wants this plan's room revenue on its own code."],
          ["Derive from another Rate Plan", "Optional. The plan's price follows the parent's, adjusted by a percentage or flat amount, e.g. -10%. A derived plan has no prices of its own and can't itself be a parent."],
          ["Negotiated rate", "For corporate and wholesale rates. It can only be booked for a company or travel agent linked to it on their profile (Negotiated Rates section)."],
          ["Complimentary / House Use", "Labels for reporting. These nights are still charged normally."],
          ["Package Allocations", "Extras included in this plan. Used only in Rate Plan level mode (see step 4)."],
        ]}
      />
      <p>
        After saving an independent plan, give it prices, either with Rate Seasons (choose the plan as the target) or from its{" "}
        <strong>Calendar</strong>. The <strong>Base Rate</strong> can&apos;t be deleted or renamed; only its charge code and package
        allocations can change.
      </p>
      <Callout title="How a night is priced" tone="note">
        <ol>
          <li>A manual rate entered on the reservation, if any.</li>
          <li>Otherwise the booked plan&apos;s price for that room type and night (for a derived plan: the parent&apos;s price plus the adjustment).</li>
          <li>Otherwise the Base Rate&apos;s price (plus the adjustment, for a derived plan).</li>
          <li>Otherwise zero.</li>
        </ol>
      </Callout>
      <p>
        Deleting a plan deletes its prices. Once reservations use a plan, its code can&apos;t be changed and it can&apos;t be deleted.
      </p>

      <H2>3. Allocations</H2>
      <Where path="Dashboard › Finance › Revenue › Allocations" who="Revenue" />
      <p>
        Allocations are the priced components of a package: meals, transfers, spa credits. They need a revenue charge code, so create
        the codes first (e.g. <em>Meal Plan — Breakfast</em>, <em>Speedboat Transfer</em>) in{" "}
        <a href="/docs/configuration/property/charge-codes">step 3</a>. Choose <strong>New Allocation</strong>:
      </p>
      <Shot name="prop-allocations" alt="The Allocations list: Breakfast, Dinner, Lunch and Speedboat transfer with their charge code, rhythm, mode and current price." />
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Code / Name", "e.g. BF / Breakfast. Code 2–10 characters, unique."],
          ["Type", "F&B, Transfer, Spa, Excursion or Other."],
          ["Charge Code", "Where its revenue posts."],
          ["Posting Rhythm", "Every night, On arrival night (e.g. an arrival transfer) or On departure night (the stay's last night)."],
          ["Rate Behaviour", "Add to Rate posts it on top of the room price. Include in Rate takes it out of the room price, so the guest pays the same total but the revenue is split to the allocation's code."],
          ["Sell Separately", "Allows it to be sold on its own, e.g. as a paid extra on your website."],
          ["Pricing", "Adult and child price per posting, from a date (and optionally to a date). Ranges must not overlap. Infants are never charged."],
          ["Active", "Only active allocations can be linked."],
        ]}
      />
      <p>
        An allocation posts nothing on nights no price range covers. Once used on a reservation its code can&apos;t be changed and it
        can&apos;t be deleted, only made inactive.
      </p>

      <H2>4. Allocation Calculation: meal plan or rate plan?</H2>
      <Where path="Hub › Controls › Revenue" who="Property Setup" />
      <p>Decide how packages attach to a reservation. You choose one, and they never combine:</p>
      <Table
        head={["Mode", "Choose it when"]}
        rows={[
          [<strong key="m">Meal Plan level</strong>, "Guests choose a board basis (BB, HB, FB) separately from the rate. The reservation's meal plan decides which allocations post. Rate plans' package allocations are ignored."],
          [<strong key="r">Rate Plan level</strong>, "Packages are built into rate plans (e.g. 'Honeymoon package'). The rate plan's package allocations decide; the meal plan is only a label."],
        ]}
      />
      <p>
        It saves as soon as you click a tile. It applies to reservations created or changed from then on, and existing bookings keep
        what they had, so decide before you take bookings.
      </p>

      <H2>5. Meal plans</H2>
      <Where path="Hub › Controls › Revenue › Meal Plans" who="Revenue" />
      <Shot name="prop-revenue" alt="The Hub Revenue page: the Allocation Calculation choice, and meal plans BB, FB and HB with their included allocations." />
      <p>
        Choose <strong>Add Meal Plan</strong>: a <strong>Code</strong> (e.g. BB, HB, FB, AI), a <strong>Name</strong>, and tick the{" "}
        <strong>Included Allocations</strong>. &quot;Room only&quot; needs no meal plan: it is built in. Once a reservation uses a
        meal plan, its code can&apos;t be changed and it can&apos;t be deleted; switch it inactive instead.
      </p>
      <Pager href="/docs/configuration/property/rates" />
    </>
  )
}
