import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "Guest lists" }

export default function GuestLists() {
  return (
    <>
      <DocTitle
        title="Guest lists"
        lead="The drop-down lists on a guest profile: nationalities, titles, ID types, VIP levels and more. Shared by every property, because a guest profile is."
      />
      <Where path="Hub › Enterprise › Guest Lists" who="Property Setup (create and update to edit)" />

      <H2>Nationalities</H2>
      <p>
        Already complete: every country, with its flag. It feeds nationality, address country and document-issuing country everywhere.
        There is nothing to set up, but you can:
      </p>
      <ul>
        <li><strong>Rename</strong> an entry to the wording your guests or authorities expect. The reset icon restores the standard name.</li>
        <li><strong>Add</strong> your own entry with a 2–3 letter <strong>Code</strong> that is not already a country code, and a <strong>Nationality</strong> label. Only entries you added can be removed.</li>
      </ul>

      <H2>Guest profile lists</H2>
      <Callout title="These start empty" tone="warn">
        <p>
          A new enterprise has no titles, genders, ID types or VIP levels. The matching drop-downs on guest profiles stay empty until
          you fill these lists, so do it before your front office starts creating profiles.
        </p>
      </Callout>
      <Shot name="ent-guest-lists" alt="The Guest Lists page: nationalities, and tabs for gender, title, ID type, classification, VIP level, dietary requirements and preferences." />
      <Table
        head={["Tab", "Typical entries"]}
        rows={[
          ["Gender", "Male, Female."],
          ["Title", "Mr, Mrs, Ms, Dr."],
          ["ID / Document Type", "Passport, National ID card, Driving licence."],
          ["Profile Classification", "Regular, Repeat guest, Corporate."],
          ["VIP Level", "Silver, Gold, Platinum."],
          ["Dietary Requirements", "Vegetarian, Vegan, Gluten-free, Halal."],
          ["Preferences", "Quiet room, High floor, Extra pillows."],
        ]}
      />
      <p>For each entry, type a <strong>Code (Internal)</strong> and a <strong>Display Value</strong>, then <strong>Add</strong>:</p>
      <ul>
        <li>The <strong>code</strong> is stored on profiles and can never be changed, so keep it short and stable, e.g. <code>GOLD</code>. It is uppercased for you.</li>
        <li>The <strong>display value</strong> is what staff see. Edit it any time with the pencil.</li>
        <li>The <strong>arrows</strong> set the order the drop-down shows everywhere.</li>
        <li>
          <strong>Delete</strong> hides an entry from new choices; profiles that already use it keep it. A deleted code cannot be
          added again, so rename rather than delete-and-re-add.
        </li>
      </ul>
      <p>
        Reservation lists (special requests, transport types, housekeeping requests) and room-feature lists belong to each property.
        They are covered in <a href="/docs/configuration/property/reservations">Reservations</a> and{" "}
        <a href="/docs/configuration/property/rooms">Rooms &amp; inventory</a>.
      </p>
      <Pager href="/docs/configuration/enterprise/guest-lists" />
    </>
  )
}
