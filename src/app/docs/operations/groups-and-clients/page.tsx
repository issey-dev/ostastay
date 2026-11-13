import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Table, H3 } from "../../components"

export const metadata: Metadata = { title: "Group blocks and Client Relations" }

export default function GroupsAndClients() {
  return (
    <>
      <DocTitle
        title="Group blocks and Client Relations"
        lead="For reservations, front office and sales staff: how a group block bills its charges, and how guest, company and agent profiles are kept."
      />

      <H2>Group blocks</H2>
      <p>
        The list can be shown as a table or as cards (on a wide screen; phones always show cards). A card carries small badges for
        what is set on the block: the account it bills, the cutoff date (amber when it is close, red once passed), the rooms held for
        each room type, <strong>Overbooked</strong> when more rooms are picked up than held, and where its Posting Master is.
      </p>

      <H3>Source details and portal logins</H3>
      <p>
        A Source&rsquo;s Overview shows its <strong>Source details</strong> (commission, who pays, early access, how bookings are
        confirmed, its Tape Chart marker) and its <strong>Agent portal logins</strong>: the people at that agency who can sign in to
        the agent portal. <strong>Add login</strong> takes an email and gives you a link to send them; it lets them choose a password
        and works once, within 7 days. <strong>Reset</strong> makes a new password link, <strong>Suspend</strong> signs the person
        out everywhere until you reactivate them. Deactivating the Source suspends all its logins; its bookings stay.
      </p>
      <p>
        A source linked to negotiated rates books <strong>only</strong> those rates, at the desk and in the portal: other rate plans
        are not offered for its bookings, and the portal never shows the published rates.
      </p>

      <H2>Slots for sources</H2>
      <p>
        A <strong>slot</strong> is a group block that belongs to a Source: the dates and rooms an agent has said they can fill.
        Agents ask for one (from the agent portal, or you record it for them), and it waits under <strong>Group Blocks › Requests</strong>.
        A request holds no rooms.
      </p>
      <ul>
        <li>
          <strong>Review and approve</strong> opens the request with everything editable: the dates, the rooms per type (what was
          asked stays shown beside it), the cutoff, rolling release, flexibility and checkpoints. Availability is checked when you
          approve; if rooms are short, it says which and by how many. The block is then held as <strong>Tentative</strong> and the
          agent can enter bookings. Make it Definite later as with any group.
        </li>
        <li><strong>Decline</strong> asks for a reason, which the agent sees.</li>
        <li>An <strong>overflow</strong> request (the house is full, a partner hotel) needs no availability, but always a person&rsquo;s decision.</li>
      </ul>
      <Table
        head={["Rule", "What it does"]}
        rows={[
          ["Cutoff", "On this date every unsold room goes back on sale, and tentative bookings still unconfirmed are released (kept as records)."],
          ["Rolling release", "Each night's unsold rooms go back on sale this many days before that night. Useful for long slots."],
          ["Checkpoints", "By a date, at least a share of the rooms must be booked. If not, the unsold rooms are released and the block carries on with what is booked."],
          ["Flexibility", "Extra rooms a night above the hold, and nights before or after the slot, that bookings may use without a new request. Always subject to the house having the room."],
        ]}
      />
      <p>
        A block&rsquo;s page shows its source, these rules (<strong>Edit slot rules</strong>), how many bookings are tentative and
        confirmed, and lists the tentative ones: tick those you have checked and choose <strong>Confirm selected</strong>. A pickup
        can be made tentative from the pickup dialog; on a tentative block with no master folio yet, the guest keeps their own folio.
        A source&rsquo;s profile lists all its slots. On a negotiated rate plan, <strong>Agent sales open on</strong> sets the day
        linked sources may start requesting slots; a source&rsquo;s early access days let it start sooner.
      </p>

      <H3>What agents do in the portal, and what you see</H3>
      <ul>
        <li>A slot request appears under <strong>Group Blocks › Requests</strong> and in the bell.</li>
        <li>Bookings agents enter in their slots appear as tentative pickups of that block, with the source&rsquo;s marker.</li>
        <li>When an agent asks you to confirm a booking (often with a payment reference), the bell tells you and the booking&rsquo;s option panel shows the request. Confirm it there, or tick several on the block and choose <strong>Confirm selected</strong>.</li>
        <li>Agents add guests, flights, the package name and special requests themselves. They can cancel a booking that is still on option (with a reason), but a confirmed one only by asking: the request shows at the top of the reservation, to <strong>Accept</strong> (then make the change as usual) or <strong>Decline</strong> with a reason they see.</li>
        <li>Agents generate their own confirmation document for their client; the hotel never writes to the agent&rsquo;s client.</li>
      </ul>

      <H3>Commission</H3>
      <p>
        A booking with a source (or a travel agent) earns commission at check-out: the commission percentage of the room rate
        without service charge and tax. Meals that are part of the rate count; Green Tax, extras, transfers and anything the guest
        spends do not. The rate plan&rsquo;s own commission for that agent is used first, else the percentage on the profile.
      </p>
      <Table
        head={["Who pays (on the source)", "What happens at check-out"]}
        rows={[
          ["Agent pays, net of commission", "When the folio goes to the agent's City Ledger account, the commission is credited on that invoice (as before), and recorded as netted."],
          ["Agent pays the full amount", "The agent is invoiced in full; the commission is recorded as owed to the agent."],
          ["Guest pays at the hotel", "The guest settles at the desk; the commission is recorded as owed to the agent."],
        ]}
      />
      <p>
        <strong>Debtors › Commissions</strong> lists every commission line with what is owed per agent. Tick lines, choose{" "}
        <strong>Approve</strong>, then <strong>Pay or offset</strong> (one agent at a time) with the method and a reference. Reversing a
        check-out reverses its commission; one already paid becomes a negative line for the next payout. The{" "}
        <strong>Commission</strong> and <strong>Source Production</strong> reports summarise them.
      </p>

      <H2>The block&apos;s travel agent, source and bill to</H2>
      <p>
        <strong>Edit block</strong> (and a new block) has three profile fields. <strong>Travel agent / company</strong> and{" "}
        <strong>Source</strong> are carried by every reservation in the block: on the reservation they are filled in and locked,
        marked <strong>from the group block</strong>. Change them on the block and the block&apos;s bookings that are tentative or
        reserved follow; guests already in house keep theirs.
      </p>
      <p>
        <strong>Bill to account</strong> is where the master bill settles when it is closed. It lists every travel agent, company
        and source that is a credit account. If the block&apos;s travel agent or source is missing from the list, open its profile
        and turn on <strong>Credit account</strong>.
      </p>

      <H2>The Posting Master</H2>
      <p>
        Every block has a <strong>Posting Master</strong>: a reservation of its own, in a room that only exists for the block, whose
        folio is the block&apos;s <strong>master folio</strong>. Charges of the group&apos;s guests that are billed to the master go on
        that folio, so one bill can be settled for the whole group (or sent to the account the block bills).
      </p>
      <ul>
        <li>It is created automatically when the block becomes <strong>Definite</strong>. For a tentative block, <strong>Create master folio</strong> creates it by hand.</li>
        <li>It is checked in automatically when the first reservation of the block checks in.</li>
        <li>It follows the block&apos;s dates, and is cancelled with the block if nothing has been posted to it. If it holds charges or has arrived, deal with those first.</li>
        <li>It is not a pickup, so it does not use up a held room, and Night Audit does not charge it a room.</li>
      </ul>
      <Callout>
        <p>
          Each booking in the group has its own eRegistration link. There is no group-level eRegistration link on the block.
        </p>
      </Callout>

      <H2>Group billing</H2>
      <p>The <strong>Group billing</strong> card on the block holds the group&apos;s paperwork and the steps done for the whole group at once:</p>
      <ul>
        <li><strong>Download group statement</strong>: one PDF with the master folio, every guest&apos;s folio and the group total.</li>
        <li><strong>Send documents</strong>: emails that PDF, with an optional message, to the address you enter.</li>
        <li><strong>Advance Folio for the group</strong>: posts the remaining nights of every guest in house today, each to the folio it bills to (the master or the guest&apos;s own). Guests not yet in house are skipped, and the result lists each one.</li>
        <li><strong>Import rooming list</strong>: paste lines (first name, last name, check-in, check-out, room type code, adults, children, email, tentative). Each line is checked like a single pickup; bad lines are listed and the rest are added.</li>
      </ul>
      <Callout>
        <p>
          An Advance Folio posted by mistake can be undone on the same business date: on the reservation, <strong>More</strong> then
          <strong> Reverse Advance Folio</strong>. Its charges are voided and Night Audit posts those nights again as usual.
        </p>
      </Callout>

      <H2>Client Relations</H2>
      <p>
        The directory has four lists: guests, corporate accounts, travel agents and staff. Each profile is one card with the name, the
        email in small type, and the badges that matter for that kind of profile:
      </p>
      <Table
        head={["List", "Badges"]}
        rows={[
          ["Guests", "Number of visits (or No stays yet), VIP level, nationality"],
          ["Corporate accounts", "Credit account, number of bookings"],
          ["Travel agents", "Commission, IATA number, credit account, number of bookings"],
          ["Staff", "Nationality"],
        ]}
      />
      <p>Click a card to open the profile. The <strong>…</strong> menu edits it. A sort (recently updated, name, most visits) and <strong>Export CSV</strong> sit above the list and apply to the profiles shown.</p>

      <H2>Sources</H2>
      <p>
        A <strong>Source</strong> is a profile type for a commercial partner that sends you bookings, such as a travel agency you
        work with closely. It can do everything a Travel Agent profile can (negotiated rates, a credit account) and adds:
      </p>
      <ul>
        <li><strong>Commission %</strong>, used when the booking&rsquo;s rate plan sets none of its own.</li>
        <li><strong>Who pays</strong>: the agent net of commission, the agent in full, or the guest at the hotel.</li>
        <li><strong>Early access (days)</strong>: how much earlier than everyone else it may request slots.</li>
        <li><strong>Bookings confirm automatically</strong>: for a trusted contract agent the hotel never checks. Off by default.</li>
        <li>Its own <strong>Tape Chart icon and colour</strong>, so its bookings are recognisable at a glance. A new Source is given a colour no other Source uses.</li>
      </ul>
      <p>
        Find Sources under the <strong>Sources</strong> tab of Client Relations. A Travel Agent profile can be turned into one with{" "}
        <strong>More › Convert to source</strong>; everything it holds stays.
      </p>
      <p>
        On a booking, the <strong>Source</strong> field sits beside <strong>Travel agent / company</strong>; a booking can carry both.
        A negotiated rate plan is offered when either of them is linked to it. If the agent or source you type is not there yet,
        choose <strong>Create &ldquo;…&rdquo;</strong> at the bottom of the list: a short form saves it and selects it without leaving
        the booking.
      </p>

      <H2>Deleting or deactivating a profile</H2>
      <p>
        Only a brand-new profile can be <strong>deleted</strong>. As soon as anything is linked to it (a booking as guest, travel agent
        or accompanying guest, a folio, a group block it pays, a registration, an eRegistration or negotiated rates) the menu offers{" "}
        <strong>Deactivate</strong> instead.
      </p>
      <ul>
        <li>A deactivated profile is hidden from searches and pickers, keeps all its history and shows an <strong>Inactive</strong> badge in Client Relations.</li>
        <li><strong>Reactivate</strong> brings it back.</li>
        <li>A profile with a booking still to come or in the house cannot be deactivated until it is done.</li>
      </ul>

      <H2>eRegistration</H2>
      <p>
        The form is pre-filled from the guest&apos;s profile. The lead guest&apos;s name is fixed (if it is wrong, correct it on the
        profile); every other detail can be updated by the guest, and the changes go onto the profile when reception applies the
        registration. A returning or VIP guest sees a small sparkle by their name.
      </p>
      <Pager href="/docs/operations/groups-and-clients" />
    </>
  )
}
