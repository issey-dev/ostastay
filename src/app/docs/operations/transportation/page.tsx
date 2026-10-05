import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../components"

export const metadata: Metadata = { title: "Transportation" }

export default function TransportationOperations() {
  return (
    <>
      <DocTitle
        title="Transportation"
        lead="For front office, airport reps and dispatch: booking transfers, putting guests from different reservations on the same boat, the day's board on a phone at the airport, and how transfers are charged."
      />
      <Where path="Dashboard › Transportation, and the Transportation card on a reservation" who="Anyone with Transportation" />

      <Callout>
        <p>
          Transportation is an add-on, switched on per property. Without it, a reservation&apos;s <strong>Transport</strong> section holds just
          the flight number, the transport number and the flight time for the pickup and the drop-off — see the end of this page.
        </p>
      </Callout>

      <H2>The words we use</H2>
      <Table
        head={["Word", "Means"]}
        rows={[
          ["Transfer", "One guest party travelling in one direction. A guest arriving and leaving has two."],
          ["Pickup / Drop-off", "Pickup brings the guest in (arrival); drop-off takes them out (departure)."],
          ["Departure", "One boat, seaplane or car leaving at a time. Guests from several reservations ride on the same departure — its passenger list is the manifest."],
          ["Airport leg", "The flight part: airline, flight number, landing or take-off time, the airport rep who meets the guest."],
          ["Needs attention", "A warning that the timing doesn't work, or the flight changed. It never stops you saving."],
        ]}
      />

      <H2>Daily workflow</H2>
      <ol className="docs-steps">
        <li><strong>Morning — review.</strong> Open Transportation. The week strip shows arrivals (↓) and departures (↑) per day. <strong>More › Suggested transfers</strong> lists this week&apos;s arrivals and departures with no transfer yet; tick them and create drafts.</li>
        <li><strong>Confirm.</strong> Open each draft, add the flight and route, and confirm it. A draft is never confirmed for you.</li>
        <li><strong>Plan the departures.</strong> <strong>More › Departures from route times</strong> creates the day&apos;s boats from the routes&apos; usual times. Then on the Board, tick guests and choose <strong>Put on departure</strong> — or <strong>New departure from selected</strong>.</li>
        <li><strong>Assign reps and boats.</strong> Tick transfers and choose <strong>Assign airport rep</strong>. Open a departure to set its boat, provider and captain.</li>
        <li><strong>During the day.</strong> Watch for Needs attention, move guests between departures, mark departures Departed and Completed — completing a departure completes everyone on it.</li>
        <li><strong>Night Audit</strong> posts the charges (below). Check the board for anything Pending.</li>
      </ol>
      <Shot name="ops-transportation-board" alt="The Transportation board: the week strip, the Board / Airport rep / Dispatch views, and the day's transfers grouped by transport type." />

      <H2>Booking a transfer</H2>
      <p>
        From the board choose <strong>New transfer</strong>, or from a reservation&apos;s <strong>Transportation</strong> card choose <strong>Add
        transfer</strong> (or one of the suggested pickup / drop-off buttons). Find the reservation by confirmation number, guest name or group
        code; the date and party fill in from the stay. For someone with no stay — a local traveller — choose <strong>Traveller without a
        stay</strong> and enter their name and phone.
      </p>
      <ul>
        <li>Pick the <strong>route</strong>: the price appears straight away, with tax, from the route&apos;s rate. No rate means complimentary.</li>
        <li>On an airport transfer, fill the <strong>flight</strong>: number, time (lands for a pickup, leaves for a drop-off), terminal, the airport rep and the meeting point and luggage.</li>
        <li><strong>More details</strong> holds the provider, boat, driver or captain, a seat or ticket note (for information only) and notes.</li>
        <li>Managers can <strong>set the price by hand</strong> with a reason.</li>
        <li>One transfer per direction: add the return as its own transfer.</li>
      </ul>

      <H3>Groups</H3>
      <p>
        Reservations in a group block show the group&apos;s code on every transfer. Filter the board by group (<strong>More filters</strong>), or
        search the group code when adding guests to a departure, then select them all at once.
      </p>

      <H2>Departures (manifests)</H2>
      <p>
        Open a departure from the <strong>Dispatch</strong> view to see who is on it, seats used against the boat&apos;s seats, and each
        guest&apos;s flight. From there:
      </p>
      <ul>
        <li><strong>Add passengers</strong> — search by name, reservation, flight or group, tick several and add them.</li>
        <li><strong>Move to…</strong> on a guest, or <strong>Move everyone to…</strong>, puts them on another departure the same day.</li>
        <li>The <strong>×</strong> takes a guest off; they stay booked, waiting for a departure.</li>
        <li><strong>Cancel departure</strong> (weather, a breakdown) takes everyone off, still booked, so you can put them on another boat.</li>
      </ul>
      <Callout tone="warn">
        <p>
          More passengers than seats is shown in red but still saved — sometimes a bigger boat is sent. Fix it by moving guests or changing
          the boat.
        </p>
      </Callout>

      <H3>Needs attention</H3>
      <Table
        head={["Warning", "What to do"]}
        rows={[
          ["Departs N min after landing", "The boat leaves too soon after the flight lands. Move the guest to a later departure."],
          ["Reaches the airport N min before the flight", "The drop-off arrives too close to take-off (the crossing time counts). Move them earlier."],
          ["Flight time changed", "The flight moved after the guest was put on the departure. Check it still works and choose Keep, or move them."],
          ["Flight details missing", "An airport transfer without a flight number or time."],
          ["The reservation is cancelled / a no-show", "The stay is off but the transfer is still booked. Cancel it or mark it a no-show; post a fee by hand if one applies."],
        ]}
      />
      <p>The allowance (default 60 minutes) is set in the Hub. Warnings never stop you saving.</p>

      <H2>At the airport, on a phone</H2>
      <p>
        The <strong>Airport rep</strong> view lists the day&apos;s flights in time order, each with the guest, party, phone (tap to call), the
        meeting notes and which boat they go on. Filter by your own name under <strong>More filters › airport rep</strong>. Tap a card for
        everything else. <strong>Dispatch</strong> shows each boat with its passenger list — the view for the jetty.
      </p>

      <H2>Charges and Night Audit</H2>
      <Table
        head={["When", "What is posted"]}
        rows={[
          ["Pickup", "At the Night Audit of the arrival day, once the guest has checked in."],
          ["Drop-off", "At the Night Audit of the guest's last night, dated the departure day — so it is on the bill when they settle at check-out."],
          ["Traveller with no stay", "At the Night Audit of the transfer day, on their own walk-in bill (Fast Post can take the payment)."],
          ["Missed day", "Caught up at the next Night Audit."],
        ]}
      />
      <ul>
        <li>Each transfer is charged <strong>once</strong>: running Night Audit again, or an Advance Bill, never charges it twice. It posts with the rate&apos;s charge code and tax, and follows the reservation&apos;s routing (group master bill, routing rules).</li>
        <li>Drafts, no-shows and cancellations are <strong>never</strong> charged automatically. Complimentary and non-billable transfers show as Complimentary.</li>
        <li>If there was no open bill to post to, the transfer shows <strong>Pending</strong> and Night Audit lists it. Open a folio and use Post charge.</li>
      </ul>
      <H3>By hand: no-shows, cancellations, fees</H3>
      <p>
        Open the transfer and choose <strong>Post charge</strong>: the full rate, or a <strong>custom amount</strong> with a reason — for a no-show
        or late cancellation fee — optionally on a different charge code. To select several on the board, tick them and choose <strong>Post
        charges</strong>. <strong>Waive charge</strong> (with a reason) stops Night Audit charging it; <strong>Bill again</strong> undoes that.
      </p>
      <p>
        A posted charge is corrected like any folio line: <strong>Void charge</strong> on the transfer (or void it on the folio — the transfer
        follows) keeps the line on the bill marked void, with your reason. Nothing is ever deleted. These actions are on the activity log.
      </p>

      <H2>Daily Transportation Report</H2>
      <p>
        <strong>More › Export report</strong>: choose dates (up to 62 days) and PDF, CSV or Excel. Transfers are grouped by day, transport type
        and direction, in departure order, with each one&apos;s departure, flight, airport rep, provider and boat, status and billing, and the
        passenger total per group. It is also in <strong>Daily Reports</strong> under Transportation.
      </p>
      <H2>The reservation&apos;s Transport section</H2>
      <p>
        Every reservation has a simple <strong>Transport</strong> section: for the pickup and for the drop-off, the <strong>flight no.</strong>,
        the <strong>transport no.</strong> (boat, vehicle or ticket) and the <strong>flight time</strong> — when the flight lands for the pickup,
        when it leaves for the drop-off, on the arrival and departure days. It never charges anything.
      </p>
      <ul>
        <li>
          <strong>Without Transportation</strong>, fill it in with <strong>Add</strong> or <strong>Edit</strong>. Clear all three fields of a
          side to remove it.
        </li>
        <li>
          <strong>With Transportation on</strong>, it is read-only and shows what is booked here: the flight, the boat and the flight time.
          Add or change transfers on the <strong>Transportation</strong> card below it, or on the board.
        </li>
        <li>
          A charge entered on a reservation before the section was simplified still shows there, and still posts at Night Audit as before.
        </li>
      </ul>
      <Pager href="/docs/operations/transportation" />
    </>
  )
}
