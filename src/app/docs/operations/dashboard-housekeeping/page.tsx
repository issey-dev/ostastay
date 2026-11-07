import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Dashboard and Housekeeping" }

export default function DashboardHousekeepingGuide() {
  return (
    <>
      <DocTitle
        title="Dashboard and Housekeeping"
        lead="For managers, front office and housekeeping supervisors: reading and customising the dashboard, and running the Housekeeping board."
      />

      <H2>The dashboard</H2>
      <p>
        The dashboard is the first page after you sign in. Under the welcome line a row of <strong>status chips</strong> shows the day at a glance, and below it
        are the tiles you have chosen: figures, charts and lists for the property you are working in. The{" "}
        <strong>7d / 14d / 30d</strong> switch sets how many days the charts cover, and <strong>Refresh</strong> reloads the figures.
      </p>
      <Table
        head={["Chip", "Means", "Opens"]}
        rows={[
          ["Night Audit", "Up to date, running (with the step it is on), or how many days behind it is. Red means more than one day behind.", "Night Audit"],
          ["Cashier shifts open", "How many cashier drawers are open now.", "Cashiering"],
          ["Channel connections", "Whether the property is connected to its channel manager and whether anything has failed.", "(shown for information)"],
        ]}
      />
      <p>A chip that opens another page ends in a small arrow, and shows where it leads when you hover over it.</p>

      <H2>Customising the dashboard</H2>
      <p>
        Use the cog beside <strong>Refresh</strong>, or the <strong>Customise dashboard</strong> button that appears when no tiles are showing. Changes apply straight
        away; there is no Save button. In the window you can:
      </p>
      <ul>
        <li>switch any tile on or off, and choose how wide it is;</li>
        <li>group tiles onto your own <strong>pages</strong> (tabs), rename and reorder them; a tab only appears once there is more than one page;</li>
        <li><strong>Reset to default</strong>, which asks first.</li>
      </ul>
      <Callout>
        <p>
          The layout is yours: it is saved for your sign-in and the property, and nobody else sees your changes. You only see tiles for the areas your role can view.
          If your role can view none of them, the dashboard says so instead of showing an empty page.
        </p>
      </Callout>

      <H2>The Housekeeping board</H2>
      <p>
        Rooms are shown as cards grouped by floor. Each card shows the room number, its status (<strong>Dirty</strong>, <strong>Clean</strong>,{" "}
        <strong>Inspected</strong>, <strong>Out of order</strong> or <strong>Out of service</strong>), the room type, who is in the room, an{" "}
        <strong>Arrival today</strong> note when someone is due in, any open housekeeping tasks, and a spanner when there is an open maintenance issue. The tabs
        above the board filter by status and show how many rooms are in each; a second filter shows one attendant&apos;s rooms.
      </p>
      <p>
        A room whose guest is <strong>due out today</strong> has a tinted card and a highlighted <strong>Due out</strong> tag, so you can see at a glance which
        occupied rooms will need cleaning next. The board stays in room order.
      </p>
      <Table
        head={["Button", "What it does"]}
        rows={[
          ["Select", "Switch on selection: tick rooms to change them together. It becomes Done while you are selecting."],
          ["Select all", "Appears once at least one room is ticked. Ticks every room on screen (with a status filter on, only the rooms you can see)."],
          ["More → Task sheets", "Opens the task sheet for an attendant."],
          ["More → Refresh", "Reloads the board."],
          ["Assign floor", "On each floor's heading: give the whole floor to an attendant."],
        ]}
      />
      <p>
        With rooms ticked, a bar appears with <strong>Mark clean</strong>, <strong>Mark inspected</strong>, <strong>Mark dirty</strong>, <strong>Mark OOO</strong>,{" "}
        <strong>Assign</strong> (to an attendant) and <strong>Report issue</strong> (to Maintenance). The menu on a single card offers the actions for that one room.
      </p>
      <Pager href="/docs/operations/dashboard-housekeeping" />
    </>
  )
}
