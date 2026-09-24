import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "Booking API keys" }

export default function BookingApiKeys() {
  return (
    <>
      <DocTitle
        title="Booking API keys"
        lead="Let your own website show live availability and take bookings. You create a key here; each property decides what its website sells."
      />
      <Where path="Hub › Enterprise › Booking API Keys" who="Integrations (create, update and delete for keys)" />
      <p>
        A key is what your web developer&apos;s site uses to talk to Uppsolut Stay. It is a password for a website, not a person.
        The developer&apos;s side is described in the <a href="/docs/api">Booking API guide</a>.
      </p>

      <H2>1. Create a key</H2>
      <p>Choose <strong>New key</strong>:</p>
      <Shot name="ent-api-key-dialog" alt="The New API key dialog: name, property, which modules the key may use, browser origins and expiry date." />
      <Table
        head={["Setting", "What to enter"]}
        rows={[
          ["Name", "Usually the website's address, e.g. www.example.com."],
          ["Property", "One property, or All properties for a group website. All properties also covers properties you add later."],
          ["May use", "Rooms, Excursions, Spa: what this website sells. Add-ons your enterprise doesn't have are greyed out."],
          ["Browser origins", "Leave empty (recommended). Only for a static site that calls Uppsolut Stay from the visitor's browser. Such a key can show excursions and spa, but not book them."],
          ["Expires", "Optional. Good practice for a key given to an outside agency."],
        ]}
      />
      <p>
        Save. <strong>The key is shown once.</strong> Copy it before choosing <strong>I have saved it</strong>, and send it to the
        developer through a password manager, never by email or chat.
      </p>
      <Shot name="ent-booking-api" alt="The API keys list with each key's properties, modules, status, last use and bookings." />

      <H2>2. Decide what each property sells</H2>
      <p>
        A key alone sells nothing. On each property&apos;s <strong>Online Booking</strong> page, switch online booking on and choose
        the rate plan, meal plan, excursions and treatments the website offers. See{" "}
        <a href="/docs/configuration/property/online-booking">Online booking</a>.
      </p>

      <H2>3. Webhooks (optional)</H2>
      <p>
        If the developer wants to be told when the property changes a booking (a trip cancelled for weather, a guest moved, a
        no-show), open the key&apos;s <strong>Webhooks</strong> (bell icon), add the URL they give you, and tick the events to send:
      </p>
      <Table
        head={["Event", "Sent when"]}
        rows={[
          ["Booking confirmed", "A booking is confirmed."],
          ["Booking cancelled", "The property cancels a booking."],
          ["Moved to another departure", "An excursion booking moves to a different departure."],
          ["Treatment completed", "A spa treatment is marked complete."],
          ["No-show", "A booking is marked no-show."],
        ]}
      />
      <p>
        Pass the developer the <strong>signing secret</strong>, which is also shown once. <strong>Send test</strong> checks the
        address works. <strong>Log</strong> shows every delivery and the answer that came back.
      </p>

      <H2>4. Hand over to the developer</H2>
      <ul>
        <li>The key, and the webhook secret if any, through a password manager.</li>
        <li>The address your staff sign in at: the API lives at the same address.</li>
        <li>A link to the <a href="/docs/api">Booking API guide</a>.</li>
      </ul>

      <H2>Looking after keys</H2>
      <Table
        head={["Action", "Effect"]}
        rows={[
          ["Edit", "Change the name, properties, modules, origins or expiry. The key itself stays the same."],
          ["Rotate", "Issues a new key; the old one stops working at once. Use it if a key may have leaked, then give the developer the new one."],
          ["Revoke", "Ends the key permanently. Bookings already made are unaffected."],
        ]}
      />
      <Callout>
        <p>
          Every key, setting and webhook change is recorded in the activity log with who made it. Each property&apos;s{" "}
          <strong>Online Booking › Online bookings</strong> tab lists everything the website booked, or tried to.
        </p>
      </Callout>
      <Pager href="/docs/configuration/enterprise/booking-api" />
    </>
  )
}
