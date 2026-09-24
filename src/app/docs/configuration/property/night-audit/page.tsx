import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "8. Night audit" }

export default function NightAudit() {
  return (
    <>
      <DocTitle
        title="Step 8 — Night audit"
        lead="Night audit closes the business day: it posts room charges and taxes, handles no-shows and departures, and moves the business date forward. Here you decide how it behaves."
      />
      <Where path="Hub › Controls › Night Audit" who="Property Setup; Night Audit (update) to change the business date" />
      <p>Every setting saves as soon as you change it, except the schedule, which has its own <strong>Save schedule</strong> button.</p>
      <Shot name="prop-night-audit" alt="The Night Audit page: business date, nightly tax postings, departures, no-shows, scheduled night audit and room status at night audit." />

      <H2>Business Date</H2>
      <p>
        The date the property is trading on. It starts at your go-live date and night audit moves it forward one day at a time. It
        is not the same as the calendar date: after midnight, until the audit runs, the business date is still yesterday.
      </p>
      <p>
        While the property is new (no reservations, bills, cashier shifts or audits yet), you can set <strong>any</strong> date:
        pick the <strong>New business date</strong> and choose <strong>Change business date</strong>. Set it to your real go-live
        day before you start. After the first activity it can only move forward, and only when a checklist on the page is all
        green: no guest in house, no earlier arrivals pending, no open cashier shift, and so on. Changing it signs the
        property&apos;s staff out.
      </p>

      <H2>Nightly Tax Postings</H2>
      <p>
        Switch <strong>Post Green Tax</strong>, <strong>Post GST</strong> and <strong>Post Service Charge</strong> on or off. The
        rates are on <a href="/docs/configuration/property/finance">Finance</a>. A property that doesn&apos;t charge a levy should switch
        it off here, rather than setting its rate to zero.
      </p>

      <H2>Departures</H2>
      <p>
        <strong>Check out settled departures automatically</strong> (off by default): when on, night audit checks out guests due to
        leave whose bill is settled. Leave it off if you want the desk to check every departure out.
      </p>

      <H2>No-Shows</H2>
      <Table
        head={["Mark a reservation that never arrived as a No-Show…", "Use when"]}
        rows={[
          ["At the arrival night's audit (default)", "Guests are expected on the day."],
          ["Hold one night for late arrivals, then mark", "Guests often arrive after midnight, e.g. on late international flights."],
          ["Never automatically — the front desk marks no-shows", "You want a person to decide every time."],
        ]}
      />
      <p>
        <strong>Post the no-show fee</strong> charges the reservation&apos;s no-show rule. It needs an active no-show rule on{" "}
        <a href="/docs/configuration/property/finance">Finance › Deposit &amp; Fee Rules</a>.
      </p>

      <H2>Scheduled Night Audit</H2>
      <p>
        Switch on <strong>Run Night Audit automatically</strong> and pick a <strong>Time</strong> between 22:00 and 06:00, property
        time, then <strong>Save schedule</strong>. The audit then runs every night without anyone at the desk.
      </p>
      <Callout tone="warn">
        <p>
          A scheduled audit stops at any step that needs a person, for example a cashier drawer left open. The Hub Overview then warns
          that it didn&apos;t complete, and someone must finish it by hand. Most properties run the audit by hand for the first
          weeks, then switch the schedule on. If you mark no-shows at the arrival night&apos;s audit, schedule it after midnight.
        </p>
      </Callout>

      <H2>Room Status at Night Audit</H2>
      <Table
        head={["Option", "Effect on vacant rooms"]}
        rows={[
          ["Off — don't change statuses", "Nothing changes."],
          ["Move one status down", "Inspected becomes Clean, Clean becomes Dirty, Dirty stays Dirty."],
          ["Set all vacant rooms to a specific status", "Every vacant room becomes Clean, Dirty or Inspected."],
        ]}
      />
      <p>Occupied rooms always become Dirty at night audit.</p>
      <Pager href="/docs/configuration/property/night-audit" />
    </>
  )
}
