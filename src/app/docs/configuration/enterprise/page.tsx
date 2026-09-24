import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../components"

export const metadata: Metadata = { title: "Enterprise & properties" }

export default function EnterpriseSetup() {
  return (
    <>
      <DocTitle
        title="Enterprise & properties"
        lead="The enterprise area holds what every property shares. Start here: check your properties, then work down the enterprise pages."
      />

      <H2>What the enterprise area covers</H2>
      <Table
        head={["Page", "What you set up", "Guide"]}
        rows={[
          ["Properties", "The properties in your enterprise, and adding new ones.", "This page"],
          ["People", "Staff accounts, roles and permissions, and each person's work location.", <a key="p" href="/docs/configuration/enterprise/people">People & roles</a>],
          ["Sessions", "Who is signed in, and signing someone out.", <a key="s" href="/docs/configuration/enterprise/security">Sessions & support access</a>],
          ["Email & SFTP", "The mail account guest emails are sent from.", <a key="e" href="/docs/configuration/enterprise/email">Email & SFTP</a>],
          ["Booking API Keys", "Keys for your own website to show availability and take bookings.", <a key="b" href="/docs/configuration/enterprise/booking-api">Booking API keys</a>],
          ["Support Access", "Approving Uppsolut support when they need to look at your data.", <a key="a" href="/docs/configuration/enterprise/security#support-access">Sessions & support access</a>],
          ["Guest Lists", "Nationalities, titles, VIP levels and other guest-profile lists.", <a key="g" href="/docs/configuration/enterprise/guest-lists">Guest lists</a>],
        ]}
      />
      <p>
        Only people with access to <strong>All Properties</strong> see the enterprise area. Staff tied to a single property never
        do.
      </p>

      <H2>Properties</H2>
      <Where path="Hub › Enterprise › Properties" who="Property Setup permission" />
      <p>
        Your first property is already here, created by Uppsolut with the details you agreed at onboarding: name, short code, legal
        name, currency, time zone, check-in and check-out times, and the go-live date.
      </p>
      <Shot name="ent-properties" alt="The Properties page listing two properties with their code, name, status, check-in and check-out times." />
      <Table
        head={["Column", "Meaning"]}
        rows={[
          ["Code", "The property's short code. It is unique across Uppsolut Stay and is the default prefix of its booking numbers."],
          ["Status", "ACTIVE properties can be set up and used. PENDING means waiting for Uppsolut's approval. REJECTED shows the reason; fix it and choose Resubmit."],
          ["Check-in / Check-out", "The property's standard times. They are edited on the property's General page."],
        ]}
      />

      <H3>Checking the property Uppsolut created</H3>
      <p>Before you configure anything, confirm these with Uppsolut. You cannot change them yourself:</p>
      <ul>
        <li>
          <strong>Currency</strong>: every price and posting is in this currency.
        </li>
        <li>
          <strong>Time zone</strong>: the scheduled night audit, business-day rollover and timestamps all follow it.
        </li>
        <li>Both are fixed once a property is active.</li>
        <li>
          <strong>Go-live date</strong>: this becomes the property&apos;s first business date. You can still move it on the Night Audit
          page until the property records its first activity.
        </li>
        <li>
          <strong>Add-ons</strong>: Spa and Excursions appear in the property menu only if your enterprise has them.
        </li>
      </ul>

      <H3>Adding another property</H3>
      <p>Choose <strong>Add Property</strong> and fill in the form:</p>
      <Shot name="ent-property-dialog" alt="The Create New Property dialog with name, short code, legal entity name, check-in and check-out times, go-live date and add-on switches." />
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Property Name", "At least 2 characters."],
          ["Short Code", "2–5 characters, unique across Uppsolut Stay. Choose it carefully: it prefixes booking numbers."],
          ["Legal Entity Name", "The company name printed on invoices."],
          ["Currency", "3 letters, e.g. USD. Every price and posting at the property is in it."],
          ["Time zone", "Where the property is, e.g. Indian/Maldives. Night audit and the business day follow it."],
          ["Check-in / Check-out Time", "HH:MM, 24-hour. Defaults 14:00 and 11:00."],
          ["Go-live date", "The property's first business date."],
          ["This property offers: Spa / Excursions", "Only if your enterprise has these add-ons. A property without a spa gets no spa charge codes."],
        ]}
      />
      <p>
        Choose <strong>Create Property</strong>. The new property is <strong>PENDING</strong> until Uppsolut approves it, and it
        can&apos;t be configured until then. While it is pending you can still edit it, including its currency and time zone; once it
        is active, those two are fixed.
      </p>
      <Callout title="Property limit" tone="warn">
        <p>Your licence limits how many properties you can have. If the form says the limit is reached, contact Uppsolut.</p>
      </Callout>
      <p>
        Once approved, pick the property from the switcher on any property page and follow the{" "}
        <a href="/docs/configuration/property">property setup</a>, or copy the setup from a property you have already configured.
      </p>
      <Pager href="/docs/configuration/enterprise" />
    </>
  )
}
