import type { Metadata } from "next"
import { CodeBlock, DocTitle, H2, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Error codes" }

const c = (s: string) => <code key={s}>{s}</code>

export default function Errors() {
  return (
    <>
      <DocTitle title="Error codes" lead="Every error is JSON with a stable code. Switch on the code, show your own message to the guest, and log the rest." />
      <CodeBlock lang="json" code={`{ "error": "Invalid request.", "code": "VALIDATION", "details": { "guest.email": "A valid email is required" } }`} />

      <H2>Access</H2>
      <Table
        head={["Status", "Code", "Meaning and what to do"]}
        rows={[
          ["401", c("MISSING_API_KEY"), "No key header. Fix the integration."],
          ["401", c("INVALID_API_KEY"), "Unknown, revoked or expired key. Ask the property for a new one."],
          ["403", c("SCOPE_NOT_GRANTED"), "The key isn't enabled for this module. Ask the property to tick it on your key."],
          ["403", c("SERVER_KEY_REQUIRED"), "Excursion and spa writes need a server-only key (no browser origins)."],
          ["404", c("PROPERTY_NOT_FOUND"), "Unknown property, or one your key doesn't cover."],
          ["409", c("MODULE_NOT_ENABLED"), "The property isn't selling this module online right now (details.reason)."],
          ["429", c("RATE_LIMITED"), "Too many requests. Wait Retry-After seconds."],
          ["429", c("TOO_MANY_HOLDS"), "Your key has too many live holds. Book or let some expire."],
        ]}
      />

      <H2>Requests</H2>
      <Table
        head={["Status", "Code", "Meaning and what to do"]}
        rows={[
          ["400", c("VALIDATION"), "Body or query failed validation. Map details onto your form fields."],
          ["400", c("IDEMPOTENCY_KEY_REQUIRED"), "Excursion/spa bookings need an Idempotency-Key header."],
          ["400", c("INVALID_DATES"), "Dates not YYYY-MM-DD, or in the wrong order."],
          ["400", c("ARRIVAL_IN_PAST"), "Before the property's business date. Build pickers off businessDate."],
          ["400", c("TOO_FAR_AHEAD"), "Rooms — beyond the property's booking window."],
          ["400", c("MIN_STAY"), "Rooms — fewer nights than the minimum."],
          ["400", c("STAY_TOO_LONG"), "The date range is too long for one call (62 nights / 62 days / 31 days)."],
          ["400", c("INVALID_OCCUPANCY"), "Rooms — no adults, or more guests than the room type holds."],
          ["400", c("INVALID_PARTY"), "Excursions — at least one adult or child is needed."],
          ["400", c("PARTY_TOO_LARGE"), "More guests than allowed per online booking / per treatment."],
          ["404", c("ROOM_TYPE_NOT_FOUND"), "Not a sellable room type of this property."],
          ["404", c("DEPARTURE_NOT_FOUND"), "Not a departure of a published excursion at this property."],
          ["404", c("TREATMENT_NOT_FOUND"), "Not a published treatment at this property."],
          ["404", c("HOLD_NOT_FOUND"), "No such hold under your key."],
          ["404", c("BOOKING_NOT_FOUND"), "Lookup: no match for that reference and email under your key."],
          ["400/409", <span key="m">{c("MEAL_PLAN_NOT_FOUND")} {c("MEAL_PLAN_NOT_OFFERED")} {c("ADD_ON_NOT_FOUND")} {c("ADD_ONS_NOT_OFFERED")}</span>, "Rooms — a meal plan or extra the property doesn't sell online."],
        ]}
      />

      <H2>Booking refusals</H2>
      <Table
        head={["Status", "Code", "Meaning and what to do"]}
        rows={[
          ["409", c("SOLD_OUT"), "No room / not enough seats left. Send the guest back a step."],
          ["409", c("SLOT_UNAVAILABLE"), "Spa — the time is no longer free."],
          ["409", c("STOP_SALE"), "Rooms — the property closed one of the dates."],
          ["409", c("NO_RATE"), "No price for a night or date. The property must fill it in."],
          ["409", c("BOOKING_DISABLED"), "Rooms — online booking is off or not set up."],
          ["409", c("DEPARTURE_CLOSED"), "The departure is cancelled or has left."],
          ["409", c("BOOKING_CUTOFF"), "Too close to the start to book online."],
          ["409", c("HOLD_EXPIRED"), "The hold ran out. Start again from availability."],
          ["409", c("HOLD_USED"), "The hold was already booked."],
          ["409", c("PRICE_CHANGED"), "The price moved since you showed it (details.total). Re-quote and confirm."],
          ["409", c("PAYMENT_NOT_CONFIGURED"), "The property can't receive PAID bookings yet — send UNPAID."],
          ["409", c("IDEMPOTENCY_CONFLICT"), "That Idempotency-Key was used for a different request."],
          ["409", c("ALREADY_CANCELLED"), "Cancel: already cancelled, completed or a no-show."],
          ["409", c("CANCEL_CUTOFF_PASSED"), "Cancel: past the free-cancellation deadline."],
          ["400", c("BOOKING_REJECTED"), "Rooms — refused for another reason; error explains."],
          ["500", c("INTERNAL_ERROR"), "Our side. Safe to retry a GET; retry a booking with the same Idempotency-Key."],
        ]}
      />
      <Pager href="/docs/api-integration/errors" />
    </>
  )
}
