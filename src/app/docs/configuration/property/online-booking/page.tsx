import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "Online booking" }

export default function OnlineBooking() {
  return (
    <>
      <DocTitle
        title="Online booking"
        lead="Choose what your own website shows and sells for this property: rooms and, with the add-ons, excursions and spa treatments."
      />
      <Where path="Hub › Controls › Online Booking" who="Integrations" />
      <p>
        Your website connects with a key created in{" "}
        <a href="/docs/configuration/enterprise/booking-api">Enterprise › Booking API Keys</a>. This page decides what that key can
        sell <em>at this property</em>. Its tabs: <strong>Website</strong>, <strong>Excursions &amp; Spa</strong> (with those
        add-ons) and <strong>Online bookings</strong>.
      </p>
      <Shot name="prop-online-booking" alt="The Online Booking page with its Website, Excursions & Spa and Online bookings tabs." />

      <H2>Website: rooms</H2>
      <p>
        The property&apos;s row shows a badge: <strong>Bookable</strong>, <strong>Booking off</strong>, or <strong>No rate plan</strong>{" "}
        (it can&apos;t sell until you choose one). Choose <strong>Edit</strong>:
      </p>
      <Table
        head={["Setting", "Notes"]}
        rows={[
          ["Accept bookings from the website", "The master switch for rooms."],
          ["Rate plan to sell", "The plan whose prices the website shows. Required while online booking is on. Negotiated plans can't be sold online. Keep this plan's prices filled: nights without a price are not sold."],
          ["Let guests choose their meal plan / Meal plan", "Offer your meal plans, or sell one fixed meal plan (or none)."],
          ["Offer paid extras online", "Offer allocations marked Sell Separately, e.g. a speedboat transfer. Tick which ones."],
          ["Minimum stay (nights)", "1–30."],
          ["Booking window (nights ahead)", "How far ahead guests can book, 1–730."],
          ["Note for the front desk", "Added to every website reservation, e.g. 'Payment to be collected on arrival'."],
          ["Headline, Description, Photo URLs, Policies", "What the website shows about the property. Policies are shown to guests, so write what you actually apply."],
        ]}
      />
      <p>Choose <strong>Save</strong>. Only active, real room types (not pseudo) are offered, and a website can never overbook.</p>

      <H2>Excursions &amp; Spa</H2>
      <p>One row per module. Its badge says <strong>Selling online</strong> when ready, or what is missing. Choose <strong>Settings</strong>:</p>
      <Table
        head={["Setting", "Default", "Notes"]}
        rows={[
          ["Accept bookings from the website", "Off", "The master switch for the module."],
          ["Hold while paying (minutes)", "10", "How long a place is kept while the guest pays on the website (5–60)."],
          ["Book at least (hours ahead)", "2", "Online booking closes this long before the start."],
          ["Largest party per booking", "10", "Excursions only. Bigger groups book with you directly."],
          ["Let guests ask for a male or female therapist", "On", "Spa only. Therapists' names are never shown."],
          ["Payment method for paid bookings", "None", "If the website takes payment, paid bookings are settled with this method. Without one, the website can only send bookings to be paid at the property."],
          ["Note for the desk / Policies", "", "Added to every online booking / shown to guests. The cancellation deadline itself comes from the excursion's or spa's cutoff."],
        ]}
      />
      <H3>What is sold</H3>
      <p>
        Switch on each excursion or treatment the website may sell, and use the pencil to add the online description, what&apos;s
        included, and photo links. Prices, times and capacity come from the excursion and spa setup. A treatment not open to walk-in
        guests can&apos;t be sold online.
      </p>

      <H2>Online bookings</H2>
      <p>
        Everything the website booked, or tried to book: rooms, excursions and spa, with the guest, total, payment and status.
        Refused attempts show the reason, and holds that ran out show as expired. <strong>Check payment</strong> flags a paid
        amount that doesn&apos;t match the total.
      </p>
      <Callout>
        <p>
          Website room bookings arrive as ordinary reservations, with remarks starting &quot;Booked via website&quot;. How staff find and
          handle them is in <a href="/docs/operations/front-desk">Online bookings at the desk</a>.
        </p>
      </Callout>
      <Pager href="/docs/configuration/property/online-booking" />
    </>
  )
}
