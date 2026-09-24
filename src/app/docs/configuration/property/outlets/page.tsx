import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "4. Outlets" }

export default function Outlets() {
  return (
    <>
      <DocTitle
        title="Step 4 — Outlets"
        lead="An outlet is a point of sale: a restaurant, bar, shop, spa or excursion desk. Each one sells its own set of charge codes, numbers its own sales checks and can raise its own walk-in bills."
      />
      <Where path="Hub › Controls › Outlets" who="Property Setup" />

      <H2>Adding an outlet</H2>
      <p>Create one outlet for each place that sells to guests. Choose <strong>Add Outlet</strong>:</p>
      <Shot name="prop-outlet-dialog" alt="The Add Outlet dialog: outlet information on the left, tax rule and charge code picker on the right." />
      <H3>Outlet Information</H3>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Name", "e.g. Reef Restaurant."],
          ["Type", "Spa, Restaurant, Bar, Retail, Transport, Recreation or Other. For grouping and reports."],
          ["Code", "2–8 letters or digits, unique at the property, e.g. REEF. It prefixes the outlet's sales-check numbers (REEF-00001). Numbers are never reused."],
          ["Address, Email, Phone, Tax No", "Optional. Printed on walk-in bills the outlet raises in its own name."],
          ["Description", "Optional."],
        ]}
      />
      <H3>Financial Information</H3>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Tax Rule", "Default: each charge code keeps its own tax (usual). Custom: force the Maldives defaults, or a custom tax profile, on everything sold here."],
          ["Charge Codes", "Tick what this outlet sells. Tick a group or subgroup to take everything under it. Only active revenue codes are listed, because taxes post automatically."],
        ]}
      />
      <p>
        The outlet can only sell the codes you tick here, so staff at the bar can&apos;t post spa treatments by mistake. Creating an
        outlet does not create charge codes: add them in <a href="/docs/configuration/property/charge-codes">step 3</a> first.
      </p>
      <Shot name="prop-outlets" alt="The Outlets list: Reef Restaurant, Sunset Bar, Coral Spa and the Dive & Excursions Desk with their codes, types and number of charge codes." />
      <Callout title="Spa and excursions">
        <p>
          If you have these add-ons, create an outlet for each (e.g. a Spa outlet and an excursions desk), then link them on{" "}
          <strong>Charge Codes › Spa Outlet / Excursion Outlet</strong>. Until they are linked, spa and excursion charges can&apos;t post,
          and the Hub Overview says so.
        </p>
      </Callout>
      <p>
        An outlet that has taken revenue can&apos;t be deleted. Edit it and untick <strong>Active</strong> to retire it.
      </p>

      <H2>Amenities</H2>
      <p>
        The <strong>Amenities</strong> card lists the property&apos;s facilities, such as the pool, gym, dive centre or kids&apos;
        club, with an optional description. They are shown to guests on your website through the Booking API. Type a{" "}
        <strong>Facility Name</strong> and choose <strong>Add</strong>. Each name can be used once; edit or delete an amenity from
        its row.
      </p>
      <Pager href="/docs/configuration/property/outlets" />
    </>
  )
}
