import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Working with agents" }

export default function WorkingWithAgents() {
  return (
    <>
      <DocTitle
        title="Working with agents"
        lead="For reservations, sales and finance: giving a source its portal logins, approving slots, confirming the bookings agents enter, answering their change requests, and settling their commission."
      />

      <H2>How it fits together</H2>
      <p>
        An agency that sells your rooms is a <strong>Source</strong> profile in Client Relations. Its staff sign in to the agent
        portal with their own logins. The work always goes in the same order:
      </p>
      <ol className="docs-steps">
        <li>The agent <strong>requests a slot</strong>: dates and rooms per room type. A request holds nothing until you approve it.</li>
        <li>You <strong>approve</strong> it. It becomes a group block for that source, with its cutoff and release rules.</li>
        <li>The agent <strong>books guests into the slot</strong>. Each booking is <strong>tentative</strong> and holds its room until its option date.</li>
        <li>The agent <strong>asks for confirmation</strong>, usually with a payment reference. You check the payment and <strong>confirm</strong> the booking.</li>
        <li>The agent adds guest details, flights and requests, and generates the guest&apos;s confirmation. It is emailed to the agent.</li>
        <li>At check-out the <strong>commission</strong> is recorded, and finance settles it from Debtors.</li>
      </ol>
      <Callout>
        <p>
          A linked source only ever sees and books the rate plans negotiated for it. The rest of the house is shown to agents capped
          (&ldquo;5+&rdquo;), never as an exact count.
        </p>
      </Callout>

      <H2>Setting up a source</H2>
      <p>Open the source in Client Relations. Its view has two cards for the portal:</p>
      <ul>
        <li><strong>Source details</strong>: the code, the commission, <strong>Who pays</strong> (the agent net of commission, the agent in full, or the guest at the hotel), how confirmations are handled, early access to new rate plans, and the <strong>Tape Chart marker</strong> that makes its bookings recognisable on the Tape Chart.</li>
        <li><strong>Portal logins</strong>: <strong>Add login</strong> with a name and an email creates an invite link (<strong>Copy link</strong>) that the agent opens to set a password. From a login&apos;s menu you can send a new link, or <strong>Suspend</strong> it at once; a suspended login is signed out everywhere.</li>
      </ul>
      <p>A login locks itself for 15 minutes after ten wrong passwords in a row. Sending a reset link clears the lock.</p>

      <H2>Slot requests</H2>
      <p>
        <strong>Group Blocks</strong> has a <strong>Requests</strong> tab with every waiting request and a count on the
        tab. Choose <strong>Review and approve</strong> to set the slot&apos;s rules before it goes live, or <strong>Decline</strong> with
        a reason the source will see.
      </p>
      <Table
        head={["Rule", "What it does"]}
        rows={[
          ["Cutoff", "The date unsold rooms return to sale. Bookings still tentative then are released and kept as records."],
          ["Rolling release", "Days before each night that night's unsold rooms return to sale."],
          ["Quota checkpoints", "A date and a percent booked: if the slot is below it, unsold rooms are released."],
          ["Flexibility", "Extra rooms a night, and nights before and after the slot, that the agent may book beyond the slot."],
        ]}
      />
      <p>An approved slot starts tentative. Make it definite from the block, as for any group. The rules can be changed later with <strong>Edit slot rules</strong>.</p>

      <H2>Confirming tentative bookings</H2>
      <ul>
        <li>A tentative booking shows its <strong>Option</strong> date. On the reservation you can <strong>Confirm</strong>, extend the option, or <strong>Release</strong> it. On its option date, an unconfirmed booking releases itself.</li>
        <li>On the block, the slot panel lists the tentative bookings and those whose agent asked for confirmation. Tick the ones you have checked and choose <strong>Confirm selected</strong>.</li>
        <li>A deposit can be collected on a tentative booking. It posts no revenue.</li>
      </ul>

      <H2>Change requests</H2>
      <p>
        An agent can cancel a booking that is still tentative, with a reason. Once a booking is confirmed, the agent can only ask:
        the request appears at the top of the reservation under <strong>Agent requests</strong>, and the reservations team is notified.
        Make the change yourself if you agree, then choose <strong>Accept</strong>; otherwise <strong>Decline</strong> with a note to the
        agent. The agent sees the answer in the portal.
      </p>

      <H2>Commission</H2>
      <p>
        At check-out, commission is worked out on the room rate without service charge and tax, rounded once to two decimals. Nothing
        is due on extras. What happens next depends on who pays:
      </p>
      <Table
        head={["Who pays", "What is recorded"]}
        rows={[
          ["The agent, net of commission", "The commission is netted on the agent's invoice."],
          ["The agent, in full", "The commission is owed to the agent."],
          ["The guest, at the hotel", "The commission is owed to the agent."],
        ]}
      />
      <p>
        In <strong>Finance › Debtors › Commissions</strong>, pick an agent to see what they are owed. Approve the lines you agree with,
        then record a payout (bank transfer, cash or cheque) or an offset against the agent&apos;s invoices. Reversing a check-out
        reverses its commission; commission already paid becomes a negative line for the next payout. The <strong>Commission</strong>{" "}
        and <strong>Source Production</strong> reports summarise it.
      </p>

      <H2>Go-live checklist</H2>
      <p>Before the first agent signs in for real:</p>
      <ul>
        <li>The source exists in Client Relations, with its commission, who pays and its marker.</li>
        <li>The source&apos;s negotiated rate plans are linked to it, and open for agent sales.</li>
        <li>The Hub&apos;s <strong>Agent portal</strong> card is switched on for the property, and the portal&apos;s key is issued.</li>
        <li>Each agent has their own login. Logins are never shared.</li>
        <li>Someone in reservations is responsible for the Requests tab and for agent change requests every day.</li>
        <li>One test booking has gone through the whole cycle: request, approve, book, confirm, check in, check out, commission paid.</li>
      </ul>

      <Pager href="/docs/operations/working-with-agents" />
    </>
  )
}
