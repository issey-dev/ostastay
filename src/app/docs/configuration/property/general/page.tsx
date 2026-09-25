import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "1. General" }

export default function General() {
  return (
    <>
      <DocTitle
        title="Step 1 — General"
        lead="The property's identity: the name, address and contact details printed on every document, its standard times, its look, and how quickly idle staff are signed out."
      />
      <Where path="Hub › Controls › General" who="Property Setup" />

      <H2>Property information</H2>
      <Shot name="prop-general" alt="The Property information card: name, legal name, short code, star rating, check-in and check-out times, logo, tax ID, phone, email and address." />
      <Table
        head={["Field", "Used for"]}
        rows={[
          ["Property name", "Everywhere: screens, documents, the website."],
          ["Legal name", "The company that issues invoices. Printed on invoices and receipts."],
          ["Short code", "The property's code. Unless you set a prefix on the Reservations page, booking numbers start with it (CBR-000123). Codes are unique across Uppsolut Stay, so avoid changing it."],
          ["Star rating", "0–5. Shown to your website through the Booking API."],
          ["Check-in / Check-out time", "Your standard times, as HH:MM (24-hour), e.g. 14:00. The Green Tax 12-hour rule can use them."],
          ["Logo", "Choose Upload logo (PNG, JPG, WebP or SVG, up to 10 MB), then crop it to the 3:2 frame; previews show the app header and a document header. Choose Save logo. It appears in the app header, on every document, report and email, and on your website."],
          ["Tax ID", "Your tax registration number (TIN). Printed on tax invoices."],
          ["Contact phone / Contact email", "Printed on documents, and given to your website."],
          ["Address", "Printed in the header of every document: invoices, receipts, letters, registration cards and statements."],
        ]}
      />
      <p>
        Choose <strong>Save</strong> at the bottom of the card; it is greyed out until you change something, and shows{" "}
        <strong>Saved</strong> once done. Changes apply to documents printed from now on. The logo saves on its own when you
        choose <strong>Save logo</strong>. For a crisp result, upload a logo with little empty space around it; zoom in on the crop
        to trim what is left.
      </p>
      <p>
        The form checks each field as you type: times as <code>14:00</code>, a valid email, a star rating of 0–5, and a short code
        no other property uses.
      </p>
      <p>
        Currency and time zone are fixed once the property is active and can&apos;t be changed here. If either is wrong, contact
        Uppsolut before you take any bookings.
      </p>

      <H2>Appearance</H2>
      <ul>
        <li>
          <strong>Banner colour</strong>: a colour for this property, used on the top line of the dashboard, the Hub band and as the
          accent on printed documents. With several properties, a different colour for each helps staff see at a glance where they
          are working. It saves as soon as you click, with a brief <strong>Saved</strong> tick.
        </li>
        <li>
          <strong>Stationery font</strong>: the typeface of printed documents (Geist, Inter, Roboto, Georgia or Courier). Saves on click, with the same tick.
        </li>
      </ul>

      <H2 id="idle-sign-out">Idle sign-out</H2>
      <Shot name="prop-general-idle" alt="The Idle sign-out card with preset buttons Off, 15 min, 30 min, 1 hour, 4 hours and a custom minutes field." />
      <p>
        How long someone at this property can be inactive before they are signed out. Choose a preset, which saves immediately, or
        type a <strong>Custom (minutes)</strong> value of at least 5 and choose <strong>Save</strong>. <strong>Off</strong> keeps
        people signed in until they sign out, End of Day, or 24 hours.
      </p>
      <p>Where staff share computers, as at most front desks, 15 or 30 minutes is a sensible choice.</p>
      <Pager href="/docs/configuration/property/general" />
    </>
  )
}
