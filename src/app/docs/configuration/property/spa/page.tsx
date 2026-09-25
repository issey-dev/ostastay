import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "Spa" }

export default function Spa() {
  return (
    <>
      <DocTitle
        title="Spa"
        lead="Treatments, the therapists who give them, the rooms they happen in, and the spa's booking rules. Available when your enterprise has the Spa add-on."
      />
      <Where path="Hub › Controls › Spa" who="Property Setup" />

      <H2>Before you start</H2>
      <ul>
        <li>A revenue <strong>charge code</strong> for treatments, e.g. 3001 Spa Treatments, in a group that reports as Other (<a href="/docs/configuration/property/charge-codes">step 3</a>).</li>
        <li>A <strong>Spa outlet</strong> (<a href="/docs/configuration/property/outlets">step 4</a>), linked on <strong>Charge Codes › Spa outlet</strong>.</li>
      </ul>
      <p>The spa engine only offers a time when a qualified therapist and a suitable room are both free, so all four parts below matter.</p>
      <Shot name="prop-spa" alt="The Spa page: treatment catalogue, therapists, treatment rooms and spa settings." />

      <H2>1. Treatment catalog</H2>
      <H3>Categories</H3>
      <p>Choose <strong>Add category</strong> (e.g. Massage, Facials, Couples), then <strong>Create</strong>. Treatments need a category first.</p>
      <H3>Treatments</H3>
      <p>Choose <strong>Add treatment</strong>, fill in the form and choose <strong>Create</strong>:</p>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Name / Category / Description", "What guests see."],
          ["Duration (min)", "The treatment itself, default 60."],
          ["Prep buffer / Cleanup buffer (min)", "Room time before and after, pre-filled from Spa settings. The room is blocked for the whole time."],
          ["Charge code", "Where the revenue posts."],
          ["Max participants", "1 for individual treatments; 2 or more for couples or group sessions."],
          ["Pricing mode", "Per person (times party size), or Flat package price."],
          ["Pricing", "Date ranges with a price, like excursions."],
          ["Bookable for in-house guests / walk-ins", "Who can have it. Treatments sold on your website must allow walk-ins."],
          ["Active", "Only active treatments can be booked."],
        ]}
      />
      <p>
        Use <strong>Rooms</strong> on a treatment to limit it to certain rooms and mark a preferred one. With none ticked, any active
        room large enough for the party can be used.
      </p>

      <H2>2. Therapists</H2>
      <p>Choose <strong>Add therapist</strong>: name, gender (guests can ask for a male or female therapist), optional phone and email, and <strong>Bookable</strong>. A therapist doesn&apos;t need a login. Choose <strong>Create</strong>. Then, on each therapist:</p>
      <Table
        head={["Button", "What to set"]}
        rows={[
          ["Skills", "Tick each treatment they are Qualified for, and Preferred where they are your first choice. Only qualified therapists are offered."],
          ["Schedule", "Their working hours per weekday, from an Effective From date. Saving replaces the whole week."],
          ["Exceptions", "Day off, leave, training, sick or unavailable, for the whole day or between two times. Extended Hours adds working time on a date — even before opening or after closing, which opens up those times for that therapist's treatments."],
        ]}
      />

      <H2>3. Treatment rooms</H2>
      <p>
        Choose <strong>Add room</strong>: name, optional code and description, and <strong>Capacity</strong>, then <strong>Create</strong>. A room with capacity 2
        can host couples treatments. Use <strong>Closures</strong> to block a room on a date for maintenance, cleaning, renovation
        or a private event.
      </p>
      <p>Deleting a category, treatment, therapist or room asks you to confirm first.</p>

      <H2>4. Spa settings</H2>
      <Table
        head={["Setting", "Default", "Notes"]}
        rows={[
          ["Opening / closing time", "09:00 / 18:00", "No treatment is offered outside these hours."],
          ["Slot interval (min)", "15", "How often start times are offered."],
          ["Require therapist / room at booking, Allow auto-assignment", "On", "Whether staff must pick, or the system may pick for them."],
          ["Charge timing", "At booking", "Post the charge when booked, or At treatment completion."],
          ["Cancellation cutoff (hours)", "4", "Cancelling after it needs a manager and applies the late-cancellation charge."],
          ["Default Prep / Cleanup Buffer (min)", "0 / 15", "Pre-filled on new treatments."],
          ["Late cancellation / no-show charge", "No charge", "None, full price, a percentage (up to 100) or a fixed amount."],
          ["Require cancellation reason", "On", "Staff must give a reason when cancelling an appointment."],
          ["No-show grace period (min)", "15", "A booking can be marked no-show only this long after its start time."],
        ]}
      />
      <p>Choose <strong>Save</strong>. Opening time must be before closing time. Until you save, the defaults apply.</p>
      <Callout>
        <p>
          To sell treatments on your own website, see <a href="/docs/configuration/property/online-booking">Online booking</a>.
        </p>
      </Callout>
      <H3>Another property?</H3>
      <p>
        <strong>Copy from…</strong> on Treatment catalog copies categories, treatments (with their prices, charge code and rooms),
        treatment rooms and Spa settings from another property. Anything this property already has is skipped, never overwritten.
        Therapists are each property&apos;s own staff, so they are never copied, and copied treatments start unpublished online.
      </p>
      <Pager href="/docs/configuration/property/spa" />
    </>
  )
}
