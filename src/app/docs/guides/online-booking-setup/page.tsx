import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Setting up online booking" }

export default function OnlineBookingSetup() {
  return (
    <>
      <DocTitle
        title="Setting up online booking"
        lead="For enterprise administrators: connect your property's website, choose what it sells online, and hand the developer what they need."
      />
      <Callout title="Where">
        <p>
          Everything here is in the <strong>Hub → Booking API</strong>. You need an enterprise-level account with the{" "}
          <strong>Integrations</strong> permission. Excursions and Spa appear only if your enterprise has those add-ons.
        </p>
      </Callout>

      <H2>1. Create a key for the website</H2>
      <p>On the <strong>API Keys</strong> tab, choose <strong>New key</strong>:</p>
      <Table
        head={["Setting", "What to enter"]}
        rows={[
          ["Name", "Usually the website's address, e.g. www.example.com."],
          ["Properties", "Tick the property — or several, for one site covering a group. The website can only see and book what is ticked."],
          ["May use", "Rooms, Excursions, Spa — what this website sells. One key can do all three."],
          ["Browser origins", "Leave empty (recommended). Only for a static site that calls us from the visitor's browser — and such a key can't book excursions or spa."],
          ["Expires", "Optional. Good practice for a key given to an outside agency."],
        ]}
      />
      <p>
        Save. <strong>The key is shown once</strong> — copy it before closing and send it to the developer through a password
        manager, never by email or chat. If it is lost, use <strong>Rotate</strong>: a new key is issued and the old one stops
        working at once. <strong>Revoke</strong> ends access permanently; bookings already made are unaffected.
      </p>

      <H2>2. Rooms: what each property sells</H2>
      <p>
        On the <strong>Properties</strong> tab, <strong>Edit</strong> each property: switch on online booking, choose the rate plan
        the website sells (required), the meal plan, minimum stay, how far ahead guests may book, a note for the desk, and the
        headline, description, photos and policies the website shows. Keep the price calendar filled for that rate plan — unpriced
        nights aren&apos;t sold online.
      </p>

      <H2>3. Excursions and Spa: what each property sells</H2>
      <p>On the <strong>Excursions &amp; Spa</strong> tab, each property has a row per module.</p>
      <H3>Settings</H3>
      <Table
        head={["Setting", "What it does"]}
        rows={[
          ["Accept bookings from the website", "The master switch. Off: the website can show the catalogue but not book."],
          ["Hold while paying", "How long a place is kept while the guest pays on the website (5–60 minutes)."],
          ["Book at least … hours ahead", "Online booking closes this long before the start."],
          ["Largest party per booking", "Excursions — bigger groups book with you directly."],
          ["Therapist gender preference", "Spa — whether guests may ask for a male or female therapist. Names are never shown."],
          ["Payment method for paid bookings", "If the website takes payment, a paid booking is settled on the bill with this method, so the bill closes at zero. Without one, the website can only send bookings to be paid at the property."],
          ["Note for the desk", "Added to every online booking."],
          ["Policies", "Shown on the website. Write what you actually honour — the cancellation deadline itself comes from the excursion's cutoff or the spa's cancellation window in the property's setup in the Hub."],
        ]}
      />
      <H3>What&apos;s sold</H3>
      <p>
        Switch on each excursion or treatment the website may sell, and use the pencil to add the description, what&apos;s included
        and photo links guests see. Prices, times, capacity, therapists and rooms come from Controls as always — this only decides
        what goes online. A treatment that doesn&apos;t accept walk-in guests can&apos;t be sold online (online guests book as
        walk-ins).
      </p>
      <p>
        The row&apos;s badge says <strong>Selling online</strong> when everything is in place, or what is missing: the module&apos;s
        outlet in the Hub, or nothing published yet.
      </p>

      <H2>4. Webhooks (optional)</H2>
      <p>
        If the developer wants to be told when you change a booking — a trip cancelled for weather, a guest moved, a no-show — open
        the key&apos;s <strong>Webhooks</strong> (bell icon), add the URL they give you and the events to send, and pass them the
        signing secret shown once. <strong>Send test</strong> checks it works; <strong>Log</strong> shows what was sent and what came
        back.
      </p>

      <H2>5. Hand over to the developer</H2>
      <ul>
        <li>The API key (and webhook secret, if any), through a password manager.</li>
        <li>The property id(s) — or they can list them with the key.</li>
        <li>The address you sign in at, and a link to these docs.</li>
      </ul>

      <H2>Keeping an eye on it</H2>
      <p>
        The <strong>Online bookings</strong> tab lists every booking the websites made or tried to make — rooms, excursions and spa —
        including refused attempts with the reason, and holds that expired. Every key, setting and webhook change is in the activity
        log with who made it.
      </p>
      <Pager href="/docs/guides/online-booking-setup" />
    </>
  )
}
