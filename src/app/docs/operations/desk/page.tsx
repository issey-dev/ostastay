import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Front Desk, Reservations and Tape Chart" }

export default function DeskGuide() {
  return (
    <>
      <DocTitle
        title="Front Desk, Reservations and Tape Chart"
        lead="For front office and reservations staff: the daily screens, what the badges and buttons mean, moving guests between rooms and handling split stays."
      />

      <H2>Front Desk</H2>
      <p>
        The tabs follow the guest&apos;s journey: <strong>Arrivals</strong>, <strong>In-House</strong>, <strong>Room moves</strong> and{" "}
        <strong>Departures</strong>, and the tiles above them show the same four numbers in the same order. On a wide screen a switch at
        the right of the search box changes the list between a <strong>table</strong> and <strong>cards</strong>; the choice is
        remembered on that computer. Phones always show cards.
      </p>
      <p>Each row or card shows the two buttons you reach for in that tab, and everything else sits behind the <strong>…</strong> menu:</p>
      <Table
        head={["Tab", "Buttons", "In the … menu"]}
        rows={[
          ["Arrivals", "Check in, Register (prints the registration card)", "Assign room, eRegistration link, Traces, View details, Mark no-show"],
          ["In-House", "Traces, Folio", "Move room, View details"],
          ["Room moves", "Traces, Folio", "Move room"],
          ["Departures", "Check out, Folio", "Traces, View details"],
        ]}
      />
      <p>
        <strong>Auto-Assign</strong> (Arrivals tab and Reservations) gives rooms to every booking that has none. It first shows a
        window listing each booking and the room it would get, and the bookings that could not be placed with the reason. Nothing is
        saved until you press <strong>Assign</strong>.
      </p>

      <H2>Reservations list</H2>
      <p>
        In card view each booking shows the guest&apos;s name, the names of the guests sharing the room in lighter type, a gold star
        for a VIP and a small repeat mark with a number for a returning guest (the number is their previous stays). The room is at the
        top right with the status under it. Small badges under the dates show what is filled in on the booking:
      </p>
      <Table
        head={["Badge", "Means"]}
        rows={[
          ["Transportation", "Transfer details are on the booking."],
          ["Trace", "There are open traces or messages."],
          ["Deposit", "A deposit has been collected (before arrival)."],
          ["Registration / eRegistration", "The registration card is done, or the guest has submitted eRegistration and it is waiting to be applied."],
          ["Special request", "The booking has special requests."],
          ["Split stay / Room move", "The stay is in more than one room segment, or a move is scheduled."],
          ["Override rate", "The rate is not the rate plan's own: a flat rate was typed, or a room change kept the old rate."],
        ]}
      />

      <H2>Moving a guest on the Tape Chart</H2>
      <ul>
        <li>Drag a booking onto another room. While you drag, rooms turn <strong>green</strong> if the booking fits all its nights and <strong>red</strong> if it does not.</li>
        <li>Dropping on a red room is blocked straight away. The message says who has the room and when, and offers <strong>Adjust the dates</strong>, which opens the booking.</li>
        <li>A room of the <strong>same type</strong> is simply a move.</li>
        <li>A room of a <strong>different type</strong> affects the rate: choose to recalculate at the new type or keep the current rate. A reason is needed for an in-house guest and optional before arrival.</li>
        <li>An in-house guest moves from the business date onward, the old room is marked dirty, and a guest due out today has nothing left to move. Only reserved and in-house bookings can be dragged.</li>
      </ul>

      <H2>Split stays</H2>
      <p>
        When you edit a reservation and press <strong>Add segment</strong>, the new segment starts as a copy of the previous one. Each
        segment has its own <strong>Room type</strong> and <strong>Rate plan</strong>, and every night is priced on the segment it
        belongs to. Packages that come with a rate plan (such as breakfast) are charged only on the nights of the segments on that plan.
      </p>
      <Callout>
        <p>
          Segments must run back to back with no gaps. The guest&apos;s room for tonight is the segment that covers tonight, which is
          what check-in and a room move use.
        </p>
      </Callout>
      <Pager href="/docs/operations/desk" />
    </>
  )
}
