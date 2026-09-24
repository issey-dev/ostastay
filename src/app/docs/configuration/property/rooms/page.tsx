import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "5. Rooms & inventory" }

export default function Rooms() {
  return (
    <>
      <DocTitle
        title="Step 5 — Rooms & inventory"
        lead="What you sell (room types) and the physical rooms guests stay in. Nothing can be booked until this step is done."
      />
      <Where path="Hub › Controls › Rooms & Inventory" who="Property Setup" />
      <p>Work in this order. Each item uses the one before it:</p>
      <ol className="docs-steps">
        <li><strong>Room features</strong>: the bed types, views and amenities you describe rooms with.</li>
        <li><strong>Room types</strong>: what guests book and you price.</li>
        <li><strong>Buildings</strong>, then <strong>floors</strong>: where rooms are.</li>
        <li><strong>Rooms</strong>: each physical room, its type and its floor.</li>
      </ol>

      <H2>1. Room features</H2>
      <p>
        In the <strong>Room Features</strong> card, fill the three tabs: <strong>Bed Type</strong> (King bed, Twin beds),{" "}
        <strong>View</strong> (Ocean view, Garden view) and <strong>Amenities</strong> (Private pool, Minibar, Wi-Fi). For each, type a{" "}
        <strong>Code (Internal)</strong> and a <strong>Display Value</strong> and choose <strong>Add</strong>. The code can&apos;t be
        changed later; the display value can. Features appear on room types and are shown to your website.
      </p>

      <H2>2. Room types</H2>
      <p>
        On the <strong>Room Types</strong> tab of <strong>Property Architecture</strong>, choose <strong>Add Room Type</strong>:
      </p>
      <Shot name="prop-room-type-dialog" alt="The Create Room Type dialog: name, code, maximum and base occupancy, description, switches for inactive, pseudo and housekeeping, and the room features picker." />
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Type Name", "What guests and staff see, e.g. Beach Villa."],
          ["Code", "Short and unique, e.g. BCH. Used on the tape chart, reports and channel mapping."],
          ["Max Occupancy", "The most guests the room takes. The desk is warned above it; your website can't book above it."],
          ["Base Occupancy (Adults)", "Adults included in the room price. Each adult above it pays the extra-adult price; every child pays the extra-child price."],
          ["Description", "Optional."],
          ["Inactive", "Stops new bookings, and takes all rooms of the type out of service."],
          ["Pseudo Room Type", "For things that are not real rooms, like a day-use or 'no room' type. Never in availability, the website or channels."],
          ["Housekeeping Enabled", "On for normal rooms. Off leaves the rooms off the housekeeping board."],
          ["Room Features", "Tick the features every room of this type has."],
        ]}
      />
      <p>
        There is no price here. A room type&apos;s price comes from the rate plans in{" "}
        <a href="/docs/configuration/property/rates">step 6</a>.
      </p>
      <Shot name="prop-room-types" alt="The Room Types list: Beach Villa, Garden Villa and Water Villa with Pool with their occupancy." />
      <Callout title="Don't delete a room type that has been used" tone="warn">
        <p>
          Deleting a room type also deletes all its rooms. Once a type has had a booking, switch it to <strong>Inactive</strong> instead.
          Switching it back on does not bring its rooms back into service: set each room&apos;s status again. Your licence also limits
          the number of room types and rooms; if a save is refused, contact Uppsolut.
        </p>
      </Callout>

      <H2>3. Buildings and floors</H2>
      <p>
        On the <strong>Buildings</strong> tab, add each building or wing (<strong>Building Name</strong>, e.g. Beachfront). A
        single-building property still needs one, e.g. Main Building. On the <strong>Floors</strong> tab, add its floors: choose
        the building, then the <strong>Floor Name/Number</strong> (e.g. Ground, 1st Floor). Always pick a building; a floor can&apos;t
        be saved without one.
      </p>

      <H2>4. Rooms</H2>
      <p>On the <strong>Rooms</strong> tab, choose <strong>Add Room</strong> for each room:</p>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Room Number / Name", "Unique at the property, e.g. 201."],
          ["Room Type", "What the room is sold as."],
          ["Building, then Floor", "Required for a physical room."],
          ["Room Features", "The room type's features are shown as fixed. Add any this room has on top, such as a connecting door."],
        ]}
      />
      <Shot name="prop-rooms" alt="The Rooms list: room numbers with their floor, room type and status." />
      <p>New rooms start as <strong>Clean</strong>. Deleting a room removes it from past reservations too, so for a room closing for good, set it out of service instead.</p>

      <H2>Housekeeping</H2>
      <p>
        <strong>Require Inspected Room at Check-In</strong> (off by default): when on, a guest can only be checked in to a room a
        supervisor has marked <strong>Inspected</strong>. When off, only out-of-order and out-of-service rooms block check-in, and a
        dirty room gives a warning.
      </p>

      <H3>Another property?</H3>
      <p>
        <strong>Copy from…</strong> on Property Architecture copies room types with their features, and on Room Features the three
        lists. Buildings, floors and rooms are physical, so each property adds its own.
      </p>
      <Pager href="/docs/configuration/property/rooms" />
    </>
  )
}
