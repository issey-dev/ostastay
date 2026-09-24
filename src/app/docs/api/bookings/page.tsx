import type { Metadata } from "next"
import { Callout, CodeBlock, DocTitle, Endpoint, H2, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Managing bookings" }

export default function Bookings() {
  return (
    <>
      <DocTitle title="Managing excursion and spa bookings" lead="A &quot;my booking&quot; page for guests: the live status of a booking, and cancelling it while it is still free to cancel." />

      <H2>Look up a booking</H2>
      <Endpoint method="GET" path="/activity-bookings/{reference}?email=ada@example.com" />
      <p>
        Returns the same <code>booking</code> object the booking call returned, with its <strong>live</strong> status. Only bookings
        made with your key are visible, and only with the email they were made with (case doesn&apos;t matter). A wrong email reads
        exactly like an unknown reference: <code>404 BOOKING_NOT_FOUND</code>.
      </p>
      <Table
        head={["Status", "Meaning"]}
        rows={[
          [<code key="1">CONFIRMED</code>, "Booked and on."],
          [<code key="2">CHECKED_IN</code>, "Spa only — the guest has arrived at the spa."],
          [<code key="3">IN_TREATMENT</code>, "Spa only — the treatment has started."],
          [<code key="4">COMPLETED</code>, "Done."],
          [<code key="5">NO_SHOW</code>, "The guest didn't come."],
          [<code key="6">CANCELLED</code>, "Cancelled — by the guest, or by the property (for example a departure called off for weather)."],
        ]}
      />
      <p>
        <strong>Moved excursions.</strong> If the property moves the guest to another departure (typically after cancelling the
        original for weather), the lookup follows it: <code>moved</code> is <code>true</code> and <code>departure</code> is the new
        one. Tell the guest the new date and time.
      </p>
      <p>
        <code>cancellation.allowed</code> says whether the guest can still cancel online, and <code>cancellation.freeUntil</code> until
        when. Show a cancel button only when it is allowed.
      </p>

      <H2>Cancel a booking</H2>
      <Endpoint method="POST" path="/activity-bookings/{reference}/cancel" note="server-only key" />
      <CodeBlock lang="json" code={`{ "email": "ada@example.com", "reason": "Change of plans" }`} />
      <p>
        Cancels the booking and takes the charge off the guest&apos;s bill. Allowed until the free-cancellation deadline — for an
        excursion, the excursion&apos;s own cutoff; for a treatment, the spa&apos;s cancellation window. After it,{" "}
        <code>409 CANCEL_CUTOFF_PASSED</code>: the guest must contact the property.
      </p>
      <CodeBlock
        lang="json"
        code={`
{
  "booking": {
    "reference": "EXC-7K3QX9MD", "status": "CANCELLED",
    "payment": { "status": "PAID", "reference": "pay_123" },
    "cancellation": { "allowed": false, "freeUntil": "2026-10-03T05:00:00.000Z", "cancelledAt": "2026-10-01T10:02:11.000Z", "refundRequired": true },
    "…": "…"
  }
}
`}
      />
      <Callout title="Refunds are yours">
        <p>
          When <code>refundRequired</code> is true the booking was sent as <code>PAID</code>: refund the guest through your own payment
          provider. The property sees the cancellation and your payment reference, and records the refund on its side.
        </p>
      </Callout>
      <Table
        head={["Refusal", "Meaning"]}
        rows={[
          [<code key="1">CANCEL_CUTOFF_PASSED</code>, "Too late to cancel online — the guest contacts the property."],
          [<code key="2">ALREADY_CANCELLED</code>, "It is already cancelled, completed or a no-show."],
          [<code key="3">BOOKING_NOT_FOUND</code>, "No booking with that reference and email under your key."],
        ]}
      />
      <p>Room bookings are looked up with <code>GET /bookings/&#123;confirmationNo&#125;</code> (see <a href="/docs/api/rooms">Rooms</a>) and are cancelled through the property.</p>
      <Pager href="/docs/api/bookings" />
    </>
  )
}
