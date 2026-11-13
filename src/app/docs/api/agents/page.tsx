import type { Metadata } from "next"
import { CodeBlock, DocTitle, Endpoint, H2, H3, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Agent API" }

const c = (s: string) => <code key={s}>{s}</code>

export default function AgentApi() {
  return (
    <>
      <DocTitle
        title="Agent API"
        lead="For a travel agent portal, or an agent's own booking system: sign agents in, show them availability and their own slots, quote, request slots and enter bookings. Every call is made by a server with an AGENT key, on behalf of a signed-in agent."
      />

      <H2>Two layers on every call</H2>
      <Table
        head={["Header", "What it is", "Who holds it"]}
        rows={[
          [c("Authorization: Bearer wsk_…"), "The API key, with the Agent portal scope. It identifies the portal installation and the hotel group.", "The portal's server. Never a browser: a key with browser origins cannot have this scope."],
          [c("X-Agent-Token: agt_…"), "The signed-in agent's session token, from /auth/login. Bound to the key that issued it.", "The portal, per agent. Not needed on /auth routes."],
        ]}
      />
      <p>
        Base address: <code>/api/agent/v1</code>. Errors use the same body as the Booking API:{" "}
        <code>{`{ "error": "…", "code": "…" }`}</code>. An agent only ever sees their own world: anything belonging to another agent
        answers <code>404</code>. Requests carrying an <code>Origin</code> header are refused (<code>SERVER_TO_SERVER_ONLY</code>).
      </p>

      <H2>Signing agents in</H2>
      <p>
        The hotel adds an agent&rsquo;s email on their Source profile and sends them a link. The link carries a one-time token your
        portal exchanges for a session while the agent chooses a password. Your portal never stores passwords.
      </p>
      <Endpoint method="POST" path="/auth/accept-invite" note="{ token, password } → 201 { token, expiresAt }" />
      <Endpoint method="POST" path="/auth/login" note="{ email, password } → { token, expiresAt }" />
      <Endpoint method="POST" path="/auth/refresh" note="a fresh token for a live one; the old one stops working" />
      <Endpoint method="POST" path="/auth/logout" />
      <Endpoint method="POST" path="/auth/forgot-password" note="{ email } → always 202" />
      <Endpoint method="POST" path="/auth/reset-password" note="{ token, password } — signs every device out" />
      <ul>
        <li>Passwords are at least 10 characters.</li>
        <li>A wrong password, an unknown email and a suspended account all answer the same <code>401 INVALID_CREDENTIALS</code>.</li>
        <li>Ten failures in a row lock the account for 15 minutes. Sign-in is also limited per account and per IP (<code>429</code>).</li>
        <li>Sessions last 12 hours; refresh before then. A session ends when the hotel suspends the login or deactivates the source.</li>
      </ul>

      <H2>Who is signed in</H2>
      <Endpoint method="GET" path="/me" />
      <CodeBlock
        lang="json"
        code={`
{ "agent": { "id": "…", "name": "Ann", "email": "ann@agency.example.com" },
  "source": { "name": "Atoll Tours", "commissionRate": 10, "settlementMode": "AGENT_NET", "earlyAccessDays": 14 },
  "properties": [
    { "id": "8f1c…", "name": "Coral Bay Resort", "code": "CBR",
      "rates": [ { "id": "…", "code": "TIERA", "name": "Tier A contract" } ],
      "liveSlots": 2, "salesOpenAt": null } ] }
`}
      />
      <p>
        Only properties with the agent portal switched on are listed. <code>rates</code> are the agent&rsquo;s negotiated rates:
        an agent never sees the hotel&rsquo;s published rates.
      </p>

      <H2>A property</H2>
      <Endpoint method="GET" path="/properties/{propertyId}" />
      <p>
        Room types (with occupancy), meal plans, the agent&rsquo;s rates, the rules for tentative bookings
        (<code>optionDaysBeforeArrival</code>, <code>shortOptionHours</code>, <code>guestDetailsDueDays</code>), the availability cap,
        the cancellation reasons to offer, and whether transfers can be booked.
      </p>

      <H2>Availability</H2>
      <Endpoint method="GET" path="/properties/{propertyId}/availability?from=YYYY-MM-DD&to=YYYY-MM-DD" note="at most 62 nights" />
      <CodeBlock
        lang="json"
        code={`
{ "ratePlan": { "code": "TIERA", "name": "Tier A contract" }, "availabilityCap": 5, "salesOpenAt": null,
  "roomTypes": [ { "code": "DLX", "name": "Deluxe", "nights": [
    { "date": "2027-02-10", "status": "AVAILABLE", "available": null, "availableLabel": "5+",
      "onOption": 3, "mySlotLeft": 2, "myReleaseDate": "2027-01-10", "rate": 180 } ] } ] }
`}
      />
      <Table
        head={["Field", "Meaning"]}
        rows={[
          [c("status"), "AVAILABLE, LIMITED (a couple left), ON_REQUEST (none free, or no rate for you), CLOSED (stop sale), NOT_ON_SALE (your sales window has not opened)."],
          [c("available"), "Rooms free in the house, up to the hotel's cap; null above it, with availableLabel \"5+\". Never includes overbooking."],
          [c("onOption"), "Rooms held on option: tentative bookings, and unsold rooms in other approved slots. A sold-out night with options may loosen."],
          [c("mySlotLeft"), "Rooms still free in your own approved slots that night. Exact."],
          [c("myReleaseDate"), "The earliest date unsold rooms in your slots go back on sale."],
          [c("rate"), "The night's price on your negotiated rate, or null."],
        ]}
      />

      <H2>Quote</H2>
      <Endpoint method="POST" path="/properties/{propertyId}/quote" note="{ roomTypeId, checkIn, checkOut, adults?, children?, ratePlanId?, mealPlan? }" />
      <p>
        The authoritative total on your negotiated rate (taxes, service charge and packages included), and the commission estimate:
        your percentage of the room rate without service charge and tax. A rate that is not yours answers{" "}
        <code>400 RATE_NOT_ALLOWED</code>; a night with no price answers <code>409 NO_RATE</code>.
      </p>

      <H3>Error codes</H3>
      <Table
        head={["Code", "When"]}
        rows={[
          [c("AGENT_NOT_SIGNED_IN"), "No X-Agent-Token, or it has expired, was revoked, or came from another key."],
          [c("INVALID_CREDENTIALS"), "Sign-in failed."],
          [c("INVALID_TOKEN"), "An invite or reset link that is wrong, used or expired."],
          [c("WEAK_PASSWORD"), "Fewer than 10 characters."],
          [c("SCOPE_NOT_GRANTED"), "The key does not have the Agent portal scope."],
          [c("NOT_ON_SALE_YET"), "Your sales window for these rates has not opened; details give the date."],
          [c("NO_RATE"), "No rate is set up for you, or a night has no price."],
          [c("RATE_NOT_ALLOWED"), "The rate is not one of yours."],
        ]}
      />
      <p>Slot requests, bookings, guest details and confirmations: see <a href="/docs/api/agents/bookings">Slots and bookings</a>.</p>
      <Pager href="/docs/api/agents" />
    </>
  )
}
