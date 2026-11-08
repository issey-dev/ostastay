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
        <strong>7d / 14d / 30d</strong> switch sets how many days the charts cover, and <strong>Refresh</strong> reloads the figures. On a phone the page
        is simply titled <strong>Dashboard</strong>, with the switch, Refresh and the cog on a row under the title.
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

      <H2>Figures, charts and movement</H2>
      <p>
        Each tile shows its key figure large, with a small pill for the change (for example against the same day last week). The first time a screen opens, the figures
        count up to their values, lines draw in, bars rise, doughnuts sweep round and the tiles lift in one after another; lists and tables show their rows one after
        another. This plays once when you open the screen. Refreshing, filtering, sorting and paging do not replay it, and a refresh only moves a figure from its old
        value to its new one.
      </p>
      <Callout>
        <p>
          If your computer or phone is set to <strong>reduce motion</strong> (in the system&apos;s accessibility settings), nothing moves: you see the finished screen at
          once. Printouts and PDF downloads never animate. Screens you work in all shift, such as forms, settings, the Housekeeping board and the menu, stay still.
        </p>
      </Callout>

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
        Rooms are shown as cards grouped by floor: three across on a desktop, two on a tablet and one on a phone. The top of each card shows the room number and its
        status (<strong>Dirty</strong>, <strong>Clean</strong>, <strong>Inspected</strong>, <strong>Out of order</strong> or <strong>Out of service</strong>), with a
        spanner beside it when there is an open maintenance issue. Under a thin line, a short list gives the <strong>Type</strong> of room, the <strong>Stay</strong>{" "}
        (who is in the room and how many, or Vacant) and the open <strong>Task</strong>. A <strong>Request</strong>, <strong>Staff</strong> or <strong>Tech</strong>{" "}
        line appears only when the room has a special request, an attendant or a technician, so most cards stay short. The tabs above the board filter by status and show
        how many rooms are in each; a second filter shows one attendant&apos;s rooms.
      </p>
      <p>
        On a phone the statuses are six tiles in two rows (All, Dirty, Clean, Inspected, Out of order, Out of service), each with its count; tap one to filter
        the board and tap <strong>All</strong> to go back. The attendant filter sits full width under them, and while a filter is on a line shows how many
        rooms match, with <strong>Clear filters</strong>. A card leaves out the Task line when the room has no task.
      </p>
      <p>
        A room whose guest is <strong>due out today</strong> shows <strong>Due out</strong> in bold amber on its Stay line, and a room with someone arriving shows{" "}
        <strong>Arrival today</strong> in bold blue, so you can see at a glance which rooms will need cleaning next. The board stays in room order. The first time the
        board opens, the cards rise into place one after another; they do not move again when you filter, refresh or change a status.
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
      <H2>From the keyboard</H2>
      <p>
        Press <kbd>G</kbd> then <kbd>D</kbd> to open the dashboard, or <kbd>G</kbd> then <kbd>H</kbd> to open Housekeeping, from any page. Press <kbd>?</kbd> for the whole
        list. See <a href="/docs/operations/keyboard-shortcuts">Keyboard shortcuts</a>.
      </p>
      <Pager href="/docs/operations/dashboard-housekeeping" />
    </>
  )
}
