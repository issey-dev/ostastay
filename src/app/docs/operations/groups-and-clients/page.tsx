import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Group blocks and Client Relations" }

export default function GroupsAndClients() {
  return (
    <>
      <DocTitle
        title="Group blocks and Client Relations"
        lead="For reservations, front office and sales staff: how a group block bills its charges, and how guest, company and agent profiles are kept."
      />

      <H2>Group blocks</H2>
      <p>
        The list can be shown as a table or as cards (on a wide screen; phones always show cards). A card carries small badges for
        what is set on the block: the account it bills, the cutoff date (amber when it is close, red once passed), the rooms held for
        each room type, <strong>Overbooked</strong> when more rooms are picked up than held, and where its Posting Master is.
      </p>

      <H2>The Posting Master</H2>
      <p>
        Every block has a <strong>Posting Master</strong>: a reservation of its own, in a room that only exists for the block, whose
        folio is the block&apos;s <strong>master folio</strong>. Charges of the group&apos;s guests that are billed to the master go on
        that folio, so one bill can be settled for the whole group (or sent to the account the block bills).
      </p>
      <ul>
        <li>It is created automatically when the block becomes <strong>Definite</strong>. For a tentative block, <strong>Create master folio</strong> creates it by hand.</li>
        <li>It is checked in automatically when the first reservation of the block checks in.</li>
        <li>It follows the block&apos;s dates, and is cancelled with the block if nothing has been posted to it. If it holds charges or has arrived, deal with those first.</li>
        <li>It is not a pickup, so it does not use up a held room, and Night Audit does not charge it a room.</li>
      </ul>
      <Callout>
        <p>
          Each booking in the group has its own eRegistration link. There is no group-level eRegistration link on the block.
        </p>
      </Callout>

      <H2>Client Relations</H2>
      <p>
        The directory has four lists: guests, corporate accounts, travel agents and staff. Each profile is one card with the name, the
        email in small type, and the badges that matter for that kind of profile:
      </p>
      <Table
        head={["List", "Badges"]}
        rows={[
          ["Guests", "Number of visits (or No stays yet), VIP level, nationality"],
          ["Corporate accounts", "Credit account, number of bookings"],
          ["Travel agents", "Commission, IATA number, credit account, number of bookings"],
          ["Staff", "Nationality"],
        ]}
      />
      <p>Click a card to open the profile. The <strong>…</strong> menu edits it.</p>

      <H2>Deleting or deactivating a profile</H2>
      <p>
        Only a brand-new profile can be <strong>deleted</strong>. As soon as anything is linked to it (a booking as guest, travel agent
        or accompanying guest, a folio, a group block it pays, a registration, an eRegistration or negotiated rates) the menu offers{" "}
        <strong>Deactivate</strong> instead.
      </p>
      <ul>
        <li>A deactivated profile is hidden from searches and pickers, keeps all its history and shows an <strong>Inactive</strong> badge in Client Relations.</li>
        <li><strong>Reactivate</strong> brings it back.</li>
        <li>A profile with a booking still to come or in the house cannot be deactivated until it is done.</li>
      </ul>

      <H2>eRegistration</H2>
      <p>
        The form is pre-filled from the guest&apos;s profile. The lead guest&apos;s name is fixed (if it is wrong, correct it on the
        profile); every other detail can be updated by the guest, and the changes go onto the profile when reception applies the
        registration. A returning or VIP guest sees a small sparkle by their name.
      </p>
      <Pager href="/docs/operations/groups-and-clients" />
    </>
  )
}
