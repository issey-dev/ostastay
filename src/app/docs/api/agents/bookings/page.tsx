import type { Metadata } from "next"
import { Callout, CodeBlock, DocTitle, Endpoint, H2, H3, Pager, Table } from "../../../components"

export const metadata: Metadata = { title: "Agent API: slots and bookings" }

const c = (s: string) => <code key={s}>{s}</code>

export default function AgentBookings() {
  return (
    <>
      <DocTitle
        title="Slots and bookings"
        lead="How an agent works with the hotel: ask for a slot, book into it on option, ask the hotel to confirm, fill in the details, and generate the confirmation for the client."
      />

      <H2>The workflow</H2>
      <ol>
        <li>The agent <strong>requests a slot</strong>: dates and rooms per room type. It holds nothing yet.</li>
        <li>The hotel <strong>approves</strong> it (possibly with changes) or declines it with a reason.</li>
        <li>The agent <strong>enters bookings</strong> in the slot: the lead guest is enough. Each starts <strong>on option</strong> until the slot&rsquo;s cutoff.</li>
        <li>The agent <strong>requests confirmation</strong> (with a payment reference); the hotel checks and confirms.</li>
        <li>The agent <strong>completes the details</strong>: accompanying guests, flights, package, requests.</li>
        <li>The agent <strong>generates the confirmation</strong>; it is emailed to the agent.</li>
        <li>At the cutoff, unsold rooms go back on sale and unconfirmed options are released (kept as records).</li>
      </ol>
      <Callout title="Every write needs an Idempotency-Key">
        Send <code>Idempotency-Key</code> (8 to 128 characters, unique per action) on every POST. Repeating a request with the same key
        returns the first answer and changes nothing; the same key with a different body is <code>409 IDEMPOTENCY_CONFLICT</code>.
      </Callout>

      <H2>Slots</H2>
      <Endpoint method="POST" path="/properties/{propertyId}/slot-requests" note="{ from, to, rooms: [{ roomTypeId, quantity }], note?, overflow? }" />
      <Endpoint method="GET" path="/slots?status=AWAITING_HOTEL|TENTATIVE|DEFINITE|DECLINED" />
      <Endpoint method="GET" path="/slots/{code}" />
      <Endpoint method="POST" path="/slots/{code}/withdraw" note="while the hotel has not decided" />
      <CodeBlock
        lang="json"
        code={`
{ "code": "REQ-K3P9Q2", "status": "TENTATIVE", "from": "2027-03-10", "to": "2027-03-14",
  "rooms": [ { "roomType": "Deluxe", "askedFor": 3, "approved": 2, "bookedTentative": 1, "bookedConfirmed": 0 } ],
  "cutoffDate": "2027-02-28", "releaseDays": null,
  "flexibility": { "extraRooms": 1, "nightsBefore": 0, "nightsAfter": 1 },
  "checkpoints": [ { "date": "2027-02-01", "minPercent": 50, "result": "PENDING", "releasedRooms": 0 } ],
  "hotelNote": null }
`}
      />
      <p>
        <code>overflow: true</code> asks for rooms at a partner hotel when the house is full; the hotel always decides those.{" "}
        <code>flexibility</code> is how far bookings may go past the slot without a new request, always subject to the house having the room.
      </p>

      <H2>Bookings</H2>
      <Endpoint method="POST" path="/slots/{code}/bookings" note="one or more rooms, all or nothing" />
      <CodeBlock
        lang="json"
        code={`
{ "rooms": [ { "roomTypeId": "…", "checkIn": "2027-03-10", "checkOut": "2027-03-13", "adults": 2,
               "leadGuest": { "firstName": "Ann", "lastName": "Lee", "email": "ann@example.com" },
               "agentReference": "FILE-77", "packageName": "Honeymoon", "requests": "High floor" } ],
  "expectedTotal": 600 }
`}
      />
      <p>
        Prices come from your negotiated rate. Send <code>expectedTotal</code> (from <code>/quote</code>) and a changed price answers{" "}
        <code>409 PRICE_CHANGED</code> with the new total. A booking is <code>ON_OPTION</code> unless the hotel confirms your bookings
        automatically. Each booking has a <code>ref</code> (<code>AG-…</code>): use it in every call below.
      </p>
      <Endpoint method="POST" path="/slots/{code}/rooming-list" note="JSON { rooms: [...] } or text/csv; each line is applied on its own (207)" />
      <Endpoint method="GET" path="/bookings?status&from&to&q&page" />
      <Endpoint method="GET" path="/bookings/{ref}" />
      <Endpoint method="POST" path="/bookings/{ref}/request-confirmation" note="{ note?, paymentReference? }" />
      <Endpoint method="PATCH" path="/bookings/{ref}/guests" note="{ guests: [{ firstName, lastName?, nationality?, dateOfBirth?, email?, phone? }] }" />
      <Endpoint method="PATCH" path="/bookings/{ref}/travel" note="{ arrival?: { flight, time, domesticFlight?, transfer?, notes? }, departure?: … }" />
      <Endpoint method="PATCH" path="/bookings/{ref}/requests" note="{ packageName?, agentReference?, requests? }" />
      <Table
        head={["Status", "Means"]}
        rows={[
          [c("ON_OPTION"), "Held until optionUntil. Released automatically if the hotel has not confirmed it by then."],
          [c("CONFIRMATION_REQUESTED"), "You asked the hotel to confirm it; still on option until they do."],
          [c("CONFIRMED"), "Confirmed by the hotel."],
          [c("IN_HOUSE"), "The guests have arrived. Read-only from here."],
          [c("COMPLETED"), "The stay is over."],
          [c("RELEASED"), "The option ran out before confirmation. Kept as a record."],
          [c("CANCELLED"), "Cancelled by you (on option) or by the hotel."],
        ]}
      />
      <p>
        Guest details are due a number of days before arrival (<code>rules.guestDetailsDueDays</code> on the property);{" "}
        <code>guestDetailsComplete</code> says whether every guest has a name, nationality and date of birth. After the due date, changes
        to a confirmed booking go through a change request.
      </p>

      <H2>Cancelling and changing</H2>
      <Endpoint method="POST" path="/bookings/{ref}/cancel" note="{ reasonCode?, reason? } — on option only, a reason is required" />
      <Endpoint method="POST" path="/bookings/{ref}/change-requests" note="{ type: AMEND | CANCEL, note?, reasonCode?, checkIn?, checkOut?, roomTypeId?, adults? }" />
      <Endpoint method="GET" path="/bookings/{ref}/change-requests" />
      <p>
        Nothing is ever deleted. A confirmed booking cannot be cancelled or changed directly: ask, and the hotel accepts or declines
        (with a reason you see). The reason codes to offer are in <code>GET /properties/&#123;id&#125;</code> as <code>cancelReasons</code>.
      </p>

      <H2>The confirmation</H2>
      <Endpoint method="POST" path="/bookings/{ref}/confirmation" note="{ showPrice?: false, email?: true }" />
      <p>
        Generates a PDF for your client with the hotel&rsquo;s details, your name and reference, the stay and the guests. On a booking
        still on option it is an <strong>option</strong> document, visibly not a confirmation. Prices are left out unless you send{" "}
        <code>showPrice: true</code>. Each call is a new version; the PDF is also emailed to you. Send{" "}
        <code>Accept: application/json</code> to get <code>{`{ filename, version, pdfBase64 }`}</code> instead of the file.
      </p>

      <H2>Webhooks</H2>
      <p>
        Register endpoints on your key in the Hub. Events about your bookings and slots:{" "}
        <code>booking.accepted</code>, <code>booking.confirmed</code>, <code>booking.released</code>, <code>booking.cancelled</code>,{" "}
        <code>change_request.decided</code>. Signing, retries and payload shape are as for the Booking API.
      </p>

      <H3>Error codes</H3>
      <Table
        head={["Code", "When"]}
        rows={[
          [c("SLOT_NOT_APPROVED"), "The slot is still waiting for the hotel, or was already decided."],
          [c("SLOT_FULL"), "Past the slot's rooms or dates and its flexibility. Request another slot."],
          [c("SLOT_CLOSED"), "The slot was declined, cancelled or lost."],
          [c("NO_AVAILABILITY"), "The house has no room for the extra you asked for."],
          [c("PRICE_CHANGED"), "The total differs from expectedTotal; details.total has the new one."],
          [c("BOOKING_LOCKED"), "The booking's state does not allow that (for example cancelling a confirmed booking)."],
          [c("REASON_REQUIRED"), "Cancelling needs a reason."],
          [c("REQUEST_PENDING"), "A change request for this booking is already waiting."],
          [c("OVERFLOW_NOT_ALLOWED"), "The hotel does not take overflow requests."],
          [c("NOT_ON_SALE_YET"), "Your sales window has not opened; details.opensAt has the date."],
          [c("IDEMPOTENCY_KEY_REQUIRED"), "A write without an Idempotency-Key."],
          [c("IDEMPOTENCY_CONFLICT"), "The Idempotency-Key was used for a different request."],
        ]}
      />
      <Pager href="/docs/api/agents/bookings" />
    </>
  )
}
