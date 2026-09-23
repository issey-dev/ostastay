import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Online bookings at the desk" }

export default function FrontDesk() {
  return (
    <>
      <DocTitle
        title="Online bookings at the desk"
        lead="For front office, excursion and spa staff: where bookings made on the property's website appear, and how to handle them."
      />

      <H2>Rooms</H2>
      <p>
        A website room booking is an ordinary reservation. Its remarks begin with &quot;Booked via website&quot; and a{" "}
        <code>WEB-…</code> reference, followed by the note your administrator set. Find it by confirmation number or that reference.
        The guest&apos;s profile is matched by email on return visits.
      </p>

      <H2>Excursions</H2>
      <ul>
        <li>On the departure&apos;s manifest, online bookings are marked <strong>Online</strong> with the guest&apos;s reference (e.g. <code>EXC-7K3QX9MD</code>), which is what the guest will quote.</li>
        <li><strong>Paid online</strong> means the website took payment: the bill is already settled with the online payment method. Otherwise the guest pays you.</li>
        <li><strong>Check payment</strong> means the amount the website reported differs from the total — check with your online payments before the trip.</li>
        <li>Seats held by the website while a guest pays show above the manifest as &quot;held online&quot;. They are released automatically if not booked.</li>
        <li>Cancel, mark no-show, cancel the whole departure or move guests exactly as for any booking. The website is told automatically.</li>
      </ul>

      <H2>Spa</H2>
      <ul>
        <li>On the spa schedule, online bookings show <strong>· Online</strong>. A time a website is holding while its guest pays shows as <strong>Held online</strong> with a dashed border; it is released automatically if not booked.</li>
        <li>Click an appointment to open its panel: guests and therapists, room, price, payment, notes and the online reference.</li>
        <li>From the panel: <strong>Check in</strong> when the guest arrives, <strong>Start treatment</strong>, <strong>Complete</strong>; or <strong>No-show</strong> and <strong>Cancel</strong>.</li>
      </ul>
      <Table
        head={["Action", "What happens to the money"]}
        rows={[
          ["Cancel before the cutoff", "The charge is voided (needs cashiering access; otherwise it is left for cashiering to void)."],
          ["Cancel after the cutoff", "Needs a manager. The spa's late-cancellation fee applies unless the manager waives it."],
          ["No-show", "Allowed once the grace time after the start has passed. The spa's no-show fee applies unless a manager waives it."],
          ["Complete", "If the spa charges at completion, the charge is posted now, at the price agreed at booking."],
        ]}
      />
      <p>The panel tells you what it did with the charge each time — voided, fee posted, or left for cashiering.</p>

      <H2>Refunds for paid online bookings</H2>
      <Callout>
        <p>
          When a booking the website took payment for is cancelled, the charge comes off the bill but the payment stays as a credit,
          and the booking says a refund is due. The <strong>website refunds the guest</strong> through its own payment provider (the
          payment reference is on the booking). Record the refund on the bill so it balances.
        </p>
      </Callout>
      <Pager href="/docs/guides/front-desk" />
    </>
  )
}
