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
        remembered on that computer. Phones always show cards, and skip the tiles: the four tabs carry the same counts.
      </p>
      <p>Each row or card shows the two buttons you reach for in that tab, and everything else sits behind the <strong>…</strong> menu:</p>
      <Table
        head={["Tab", "Buttons", "In the … menu"]}
        rows={[
          ["Arrivals", "Check in (reads Assign & check in while the booking has no room yet), Register (prints the registration card)", "Assign room, eRegistration link, Traces, View details, Mark no-show"],
          ["In-House", "Traces, Folio", "Move room, View details"],
          ["Room moves", "Traces, Folio", "Move room"],
          ["Departures", "Check out, Folio", "Traces, View details"],
        ]}
      />
      <p>
        A small <strong>warning triangle</strong> beside an arrival&apos;s name means the guest&apos;s profile is incomplete. Hover over it to see exactly what is
        missing (nationality, date of birth and/or an ID document). It never stops a check-in: you can complete the details in the check-in steps or skip them.
      </p>
      <p>
        <strong>Check in</strong> opens the check-in steps. If the booking has no room yet, the button reads <strong>Assign &amp; check in</strong> and the first
        step is choosing a room. If the booking has no room type or rate either, that step says so and offers <strong>Choose room &amp; rate</strong>,
        which opens the booking to pick them; then come back and check the guest in.
      </p>
      <p>
        <strong>The folio on a phone:</strong> the header with the close button stays at the top while you scroll, and{" "}
        <strong>Post charge</strong> and <strong>Post payment</strong> are pinned at the bottom of the screen. Each opens its form as a sheet from the
        bottom; posting closes it.
      </p>
      <p>
        <strong>Auto-Assign</strong> (a button on the Arrivals tab, and under <strong>More</strong> at the top of Reservations, next to Tape Chart) gives rooms to every booking that has none. It first shows a
        window listing each booking and the room it would get, and the bookings that could not be placed with the reason. Nothing is
        saved until you press <strong>Assign</strong>.
      </p>

      <p>
        <strong>From the keyboard:</strong> on a computer, <kbd>J</kbd> and <kbd>K</kbd> move down and up the lists, <kbd>C</kbd> checks in, <kbd>O</kbd> checks out
        (it always asks first), <kbd>F</kbd> opens the folio, <kbd>A</kbd> assigns a room, <kbd>M</kbd> moves a room, <kbd>1</kbd> to <kbd>4</kbd> switch tab and{" "}
        <kbd>Enter</kbd> opens the booking. A short reminder is shown above the list, and the full list is behind <kbd>?</kbd>. See{" "}
        <a href="/docs/operations/keyboard-shortcuts">Keyboard shortcuts</a>.
      </p>

      <H2>Reservations list</H2>
      <p>
        <strong>New booking</strong> is the main button at the top. <strong>Tape Chart</strong> and <strong>Auto-Assign</strong> are under <strong>More</strong>
        next to it, on a phone as well as on a computer. While the list loads you see grey row-shaped placeholders in place of the bookings.
      </p>
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

      <H2>Reading the Tape Chart</H2>
      <p>
        Rooms run down the left, grouped by floor, and days run across. Use <strong>7 days</strong>, <strong>14 days</strong> or <strong>30 days</strong> to change how
        many you see, the arrows to move a week at a time, <strong>Today</strong> to jump back to the business date, and the date box to jump to any date.
      </p>
      <Table
        head={["What you see", "Means"]}
        rows={[
          ["A bar with a surname and a number", "A booking in that room for those nights. The number is the booking's confirmation number. Hover over the bar for the guest's full name and the status."],
          ["Bar colour", "The status: reserved, in-house, checked out or no-show, as in the key above the chart. A room with no bar is free."],
          ["Unassigned row", "Bookings that have no room yet, shown at the top. Drag one onto a room to give it one."],
          ["Highlighted column in the date row", "Today (the business date)."],
          ["Shaded columns", "Saturdays and Sundays."],
        ]}
      />
      <ul>
        <li>The date row and the room names stay in view as you scroll sideways or down, and booking bars slide underneath the room names.</li>
        <li>Click an empty day in a room to start a booking for that room and date.</li>
        <li>Click a bar to see the booking and its actions.</li>
      </ul>

      <H2>Moving a guest on the Tape Chart</H2>
      <ul>
        <li>Drag a booking onto another room. While you drag, rooms turn <strong>green</strong> if the booking fits all its nights and <strong>red</strong> if it does not.</li>
        <li>Dropping on a red room is blocked straight away. The message says who has the room and when, and offers <strong>Adjust the dates</strong>, which opens the booking.</li>
        <li>A room of the <strong>same type</strong> is simply a move.</li>
        <li>A room of a <strong>different type</strong> affects the rate: choose to recalculate at the new type or keep the current rate. A reason is needed for an in-house guest and optional before arrival.</li>
        <li>After a move, the booking <strong>pulses twice</strong> in its new place so you can see where it went (not when your device is set to reduce motion).</li>
        <li>An in-house guest moves from the business date onward, the old room is marked dirty, and a guest due out today has nothing left to move. Only reserved and in-house bookings can be dragged.</li>
      </ul>
      <p>
        <strong>If the stay has several room segments</strong>, each segment is its own bar and a drag moves only that bar: its dates,
        the other segments and their rooms stay as they are, and the fit check looks at that segment&apos;s own nights. A different
        room type changes the rate of that segment only, and the booking&apos;s <strong>Room move</strong> badge updates. An in-house
        guest can only drag the segment they are in tonight; a move splits that segment from tonight to where it ends and leaves later
        segments alone. To change dates, or a segment you cannot drag, use <strong>Adjust the dates</strong> (Edit reservation).
      </p>

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
