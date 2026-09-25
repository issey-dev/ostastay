import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager } from "../../components"

export const metadata: Metadata = { title: "Go-live checklist" }

const Check = ({ children }: { children: React.ReactNode }) => <li>☐ {children}</li>

export default function GoLive() {
  return (
    <>
      <DocTitle
        title="Go-live checklist"
        lead="Go through this list before the first real guest. Print it, tick it, and keep it with your onboarding records."
      />
      <Callout>
        <p>
          Start with the Hub <strong>Overview</strong>. It should say <em>Everything is set up — nothing needs attention</em>. The
          list below covers what the Overview can&apos;t check for you.
        </p>
      </Callout>

      <H2>Enterprise</H2>
      <ul>
        <Check>Every member of staff has their own account, with the right roles and work location. Email addresses are in lower case.</Check>
        <Check>Only the people who need it have Property Setup, Users &amp; Access or Integrations.</Check>
        <Check>Outgoing email is saved, and a test email arrived (and not in spam).</Check>
        <Check>Guest lists are filled: titles, genders, ID types, VIP levels.</Check>
      </ul>

      <H2>Each property</H2>
      <ul>
        <Check>Currency, time zone and business date are right. The business date is your go-live day.</Check>
        <Check>Name, legal name, address, tax ID, phone, email and logo are correct: print a test invoice to check.</Check>
        <Check>Prices include taxes is set as intended, and the tax rates match your registration.</Check>
        <Check>Payment methods exist for every way guests pay, including City Ledger if you invoice companies; the settlement default is set.</Check>
        <Check>Revenue charge codes exist for everything you sell, and each generates the right taxes.</Check>
        <Check>Every outlet sells the right charge codes; spa and excursion outlets are linked.</Check>
        <Check>Every room exists with the right room type, building and floor. Room count matches reality.</Check>
        <Check>The Base Rate and every independent rate plan are priced at least a year ahead: check the calendars for &quot;No rate&quot; days.</Check>
        <Check>Allocations have prices covering the year; meal plans include the right allocations; the Allocation calculation mode is the one you want.</Check>
        <Check>Booking number format is right. Sequences continue from your old system if needed.</Check>
        <Check>Fee rules are active with the right amounts, if you charge cancellation or no-show fees.</Check>
        <Check>Night audit: nightly postings, no-show timing and room-status options chosen. Decide who runs the first audits by hand.</Check>
        <Check>Invoice payment details, terms and letter policy text are filled in; the registration card wording is approved.</Check>
        <Check>Idle sign-out is set for shared computers.</Check>
      </ul>

      <H2>If you use them</H2>
      <ul>
        <Check>Excursions have prices, schedules and generated departures; spa has treatments, qualified therapists with hours, rooms and settings.</Check>
        <Check>Online booking: the rate plan to sell is chosen and priced; a test booking made from the website appears at the desk.</Check>
        <Check>Channel manager: every room type mapped, default rate plan chosen, preview checked, sharing on.</Check>
      </ul>

      <H2>A dry run</H2>
      <Callout title="Set the business date first" tone="warn">
        <p>
          A property&apos;s business date can be set freely only until its first activity. A test reservation counts, and after it
          the date only moves forward. Set the business date to your go-live day <em>before</em> any test, and don&apos;t run night
          audit on a test before go-live: it would move the date past your go-live day.
        </p>
      </Callout>
      <p>The safest full rehearsal is on a training property. Ask Uppsolut if you would like one. On the live property, keep the rehearsal to steps that don&apos;t close the day:</p>
      <ol className="docs-steps">
        <li>Create a reservation with a meal plan, check the price, and email the confirmation letter to yourself.</li>
        <li>Post a charge through an outlet and take a deposit.</li>
        <li>Print the proforma folio and check the taxes, wording and payment details.</li>
        <li>Cancel the test reservation.</li>
      </ol>
      <p>
        The test uses real numbers from your sequences. If your finance team needs the first real invoice and booking numbers to start
        clean, rehearse on a training property instead.
      </p>
      <Pager href="/docs/configuration/go-live" />
    </>
  )
}
