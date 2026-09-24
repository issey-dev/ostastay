import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "3. Charge codes" }

export default function ChargeCodes() {
  return (
    <>
      <DocTitle
        title="Step 3 — Charge codes"
        lead="Every amount that lands on a guest's bill posts to a charge code. Codes are grouped for reports, and each one knows which taxes to add. This is the property's chart of accounts."
      />
      <Where path="Hub › Controls › Charge Codes" who="Property Setup" />

      <H2>How it fits together</H2>
      <Table
        head={["Level", "Example", "Purpose"]}
        rows={[
          ["Group", "FNB — Food & Beverage", "The top of the tree. Its Reports As bucket (Room, Food & Beverage, Transport, Other, Tax, Non-Revenue, System) decides where revenue appears in reports."],
          ["Subgroup", "20RV — Restaurant", "A finer grouping inside a group, e.g. Restaurant and Bar inside Food & Beverage."],
          ["Charge code", "2001 — Breakfast", "What staff post to. Belongs to one subgroup."],
          ["Generates", "2001 → 7000 service charge, 8000 GST", "The taxes and levies a code adds automatically when it is posted."],
        ]}
      />
      <p>Agree the codes with your finance team or accountant first. The numbering is yours to choose. A common scheme:</p>
      <Table
        head={["Range", "Used for"]}
        rows={[
          ["1000–1999", "Accommodation (1000 is already there)"],
          ["2000–2999", "Food & beverage: restaurant, bar, in-room dining, meal-plan components"],
          ["3000–3999", "Spa"],
          ["4000–4999", "Excursions and activities"],
          ["5000–5999", "Transport: transfers, speedboat, seaplane"],
          ["6000–6999", "Other income: laundry, shop, telephone"],
          ["7000–9999", "Taxes, non-revenue and payments (system codes already there)"],
        ]}
      />

      <H2>What is already there</H2>
      <p>
        A new property has the <strong>system codes</strong> (marked <strong>Sys</strong>) under ready-made groups. You can rename
        their description, move them to another subgroup or change their tax, but not their code number, and they can&apos;t be
        deleted. Accommodation (1000) already generates service charge, GST and Green Tax.
      </p>
      <Shot name="prop-charge-codes-new" alt="The Charge Codes card on a new property, listing only the system codes 1000 to 9901 with their group, posting type and generated taxes." />
      <p>
        The groups are there too (Accommodation, Food &amp; Beverage, Transport, Others, Taxes &amp; Levies, Non-Revenue, System, plus
        Spa and Excursions if you have those add-ons), but only the subgroups that hold system codes. Your own revenue subgroups and
        codes are up to you.
      </p>

      <H2>Adding your revenue codes</H2>
      <H3>1. Add subgroups</H3>
      <p>
        In <strong>Charge Groups &amp; Subgroups</strong>, add the subgroups your codes will sit in: choose the <strong>Group</strong>,
        a <strong>Code</strong> (e.g. <code>20RV</code>) and a <strong>Name</strong> (e.g. Restaurant). Add a group of your own
        only if none of the existing ones fits.
      </p>
      <H3>2. Add charge codes</H3>
      <p>Choose <strong>Add Charge Code</strong>:</p>
      <Shot name="prop-charge-code-dialog" alt="The Add Charge Code dialog: code, posting type, description, group / subgroup, active and tax." />
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Code Identifier", "Unique at this property, e.g. 2001. Uppercased."],
          ["Posting Type", "Charge for anything you sell. Tax, Levy, Credit and Non-Revenue are for special codes; you rarely need them."],
          ["Description", "What staff and guests see on the bill, e.g. Breakfast."],
          ["Group / Subgroup", "Decides the reporting bucket."],
          ["Active", "Only active codes are offered when posting."],
          ["Tax", "Default (Maldives Tax) adds service charge and GST. Custom Tax uses a profile from Finance (step 2)."],
        ]}
      />
      <p>
        A new <strong>Charge</strong> code automatically generates service charge (7000) and GST (8000). One in an Accommodation group
        also generates Green Tax. Check the result with the code&apos;s <strong>Generates</strong> button.
      </p>
      <H3>3. Adjust what a code generates (if needed)</H3>
      <p>
        Open a code&apos;s <strong>Generates</strong> to add, change or remove what it posts automatically, for example a code sold
        without service charge. Each line has the code it <strong>Generates</strong>, a <strong>Method</strong> (the service charge,
        GST or Green Tax rates from Finance, a percentage, a flat amount, or an amount per person per night), what it is{" "}
        <strong>Calculated On</strong>, and the <strong>Order</strong> lines are worked out in.
      </p>
      <Callout title="Codes in use" tone="warn">
        <p>
          Once anything has been posted to a code, it can&apos;t be deleted, only made inactive. Getting the list right before go-live
          saves clutter later.
        </p>
      </Callout>

      <H2>Posting Defaults</H2>
      <Shot name="prop-posting-defaults" alt="The Posting Defaults card: accommodation, Green Tax and commission charge codes." />
      <Table
        head={["Default", "Pre-set to", "Used for"]}
        rows={[
          ["Accommodation Charge Code", "1000", "Nightly room charges, unless a rate plan names its own code."],
          ["Green Tax Charge Code", "8500", "Green Tax postings."],
          ["Commission Charge Code", "9100", "Travel-agent commission. Choose None to stop posting commission."],
        ]}
      />
      <p>Leave these as they are unless your accountant wants room revenue split differently.</p>

      <H2>Spa Outlet and Excursion Outlet</H2>
      <p>
        If you have the Spa or Excursions add-on, this page also has a <strong>Spa Outlet</strong> and an{" "}
        <strong>Excursion Outlet</strong> card. Spa and excursion charges can&apos;t post until you pick an outlet for each. Create the
        outlets in the next step, then come back and link them.
      </p>
      <Pager href="/docs/configuration/property/charge-codes" />
    </>
  )
}
