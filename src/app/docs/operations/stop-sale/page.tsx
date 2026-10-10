import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Price calendar and stop sale" }

export default function StopSale() {
  return (
    <>
      <DocTitle
        title="Price calendar and stop sale"
        lead="For revenue managers, reservations and front office: reading prices on the Revenue calendar, closing dates to sale, and booking a closed date when you have to."
      />

      <H2>The price calendar</H2>
      <p>
        <strong>Finance › Revenue › Calendar</strong> is the first tab of Revenue. It is for looking, not for typing: it shows one
        month for one room type and one rate plan, and opens on the Base Rate and the first room type. Use the rate plan drop-down
        and the room type buttons to look elsewhere.
      </p>
      <ul>
        <li>Each day shows the nightly price. Hover a day to see the extra adult and extra child prices.</li>
        <li><strong>NA</strong> means that plan has no price of its own for that night. (At night audit such a night is charged at the Base Rate, but the calendar does not show another plan&apos;s price as if it were this plan&apos;s.)</li>
        <li>A small blue dot marks a price worked out from a parent plan, for a derived rate plan.</li>
        <li><strong>Closed</strong> with a red mark means the room type is on stop sale that night.</li>
        <li>A rate plan&apos;s own <strong>Calendar</strong> button (on the Rate plans tab) opens the same calendar fixed to that plan. It cannot be switched to another plan from there.</li>
      </ul>

      <H2>Changing prices from the calendar</H2>
      <ol className="docs-steps">
        <li>Click a day, or click a first and a last day. The selected days are shaded.</li>
        <li>In the bar above the calendar choose <strong>Update prices</strong>. Rate seasons opens with the rate plan, room type and dates already chosen.</li>
        <li>Enter the daily price (and extra adult and child prices if they differ), check the room types, and choose <strong>Push prices to calendar</strong>.</li>
        <li>You are taken back to the calendar, which now shows the new prices.</li>
      </ol>
      <p>
        Rate seasons works in three steps, each opening only after the one before is saved: the rate plan, then the season and price,
        then the room types. Coming from the calendar, all three are already filled in and you can open any of them to change it.
        Derived rate plans cannot be priced directly — change their parent plan instead. The calendar is not available for pricing on
        a phone; Rate seasons is a computer task.
      </p>

      <H2>Stop sale</H2>
      <p>
        A stop sale closes a date to <strong>new</strong> bookings. It can close one room type or the whole property, and it applies
        to every rate plan. Set it either from the calendar (select the days, then <strong>Stop sale</strong>) or on{" "}
        <strong>Front Office › Availability</strong>. Reopen the same way. Setting or lifting a stop sale needs access to update
        Availability.
      </p>
      <Table
        head={["Who is stopped", "What happens"]}
        rows={[
          ["Your website (Booking API)", "The night shows as closed and a booking for it is refused with STOP_SALE."],
          ["The channel manager", "The room type is closed at the channel — not just shown as zero rooms. The change is sent straight away, not at the next scheduled update."],
          ["Staff creating or editing a booking", "Warned and stopped, unless they have Availability update access and choose Override Restriction."],
          ["Bookings that already exist", "Nothing changes. A guest already holding a closed night keeps it, and editing an unrelated detail never trips the stop sale."],
        ]}
      />

      <H2>Booking a closed date: Override Restriction and Overbook</H2>
      <p>
        When a booking touches a closed night, staff with Availability update access are asked whether to continue. There are two
        separate questions, and they are never merged:
      </p>
      <Table
        head={["Choice", "What it ignores", "Needs"]}
        rows={[
          ["Override Restriction", "The stop sale. The room must still be free.", "Availability update access"],
          ["Overbook", "Physical availability — sells a room type that has no free rooms.", "As before"],
        ]}
      />
      <Callout title="Closed and full">
        <p>
          If a night is both on stop sale and sold out, one message shows both warnings and you must accept both. Overriding only the
          restriction still leaves the booking blocked for lack of rooms, and the other way round. Every override is recorded in the
          activity log. Websites and channels can never override a stop sale — that is what it is for.
        </p>
      </Callout>
      <p>
        Group pickup still refuses a closed date without an override. If you need to pick up a group on a closed night, lift the stop
        sale first.
      </p>
      <Pager href="/docs/operations/stop-sale" />
    </>
  )
}
