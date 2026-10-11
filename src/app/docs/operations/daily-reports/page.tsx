import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Table } from "../../components"

export const metadata: Metadata = { title: "Daily Reports" }

export default function DailyReports() {
  return (
    <>
      <DocTitle
        title="Daily Reports"
        lead="For managers, front office, finance and housekeeping: reading a report on screen, and downloading it as a PDF, Excel, delimited text or CSV file."
      />

      <H2>Reading a report</H2>
      <p>
        Open <strong>Daily Reports</strong> and choose a report from the list on the left (on a tablet or phone, from the list at the
        top). The list is folded by group — open a group to see its reports, or type in <em>Find a report</em> and every matching
        group opens by itself. Point at a report and click its star to make it a <strong>Favorite</strong>; favorites sit at the top
        of the list, followed by your three most <strong>Recent</strong> reports. Favorites and recents are kept on that computer.
        The report opens straight away for today&apos;s business date. Change the date, date range or filters above it and it
        updates by itself — there is no Preview button to press.
      </p>
      <ul>
        <li><strong>Key figures</strong> across the top give the answer at a glance — arrivals, balance due, room revenue, open traces and so on.</li>
        <li><strong>Charts</strong> show how the figures break down: by status, room type, outlet, day or travel agent. Choose <em>View as table</em> under a chart for the same numbers as text.</li>
        <li><strong>Details</strong> is the full list. Click a column heading to sort, type in the search box to narrow it, and use the arrow beside a group name to fold it away. Totals stay in view at the bottom.</li>
        <li>Where a list shows a confirmation number, click it to open that reservation.</li>
        <li>The address in your browser holds the report and its dates, so you can bookmark it or send the link to a colleague.</li>
      </ul>

      <Shot name="ops-daily-reports" alt="The Availability report: the report list at the side, the date range and filters, three key figures, a chart of rooms sold and available for each night, and the details list grouped by room type." />

      <H2>Downloading</H2>
      <p>
        Choose <strong>Download as…</strong> and pick a file type. The file holds exactly what is on screen. Your last choice is
        remembered on that computer.
      </p>
      <Table
        head={["File type", "Best for", "Choices"]}
        rows={[
          ["PDF", "Printing and filing", "Page orientation, and whether to include the key figures and charts."],
          ["Excel (.xlsx)", "Working on the numbers", "A Summary sheet with the key figures and the numbers behind each chart."],
          ["Delimited text (.txt)", "Sending to another system", "Delimiter (tab, pipe, semicolon, comma or one character of your own), text qualifier, encoding, line ending, header row."],
          ["CSV (.csv)", "Opening in any spreadsheet", "The same as delimited text, always comma separated."],
        ]}
      />
      <Callout>
        Text and CSV files are <strong>data only</strong> by default: one heading row, then one line per record, with plain numbers
        and dates written as year-month-day. That is what other systems expect. To get the older layout — title, group headings and
        subtotals — choose <em>As printed</em> under Layout.
      </Callout>
      <p>
        <strong>Print</strong> opens the PDF in a new tab so you can print it. On a phone or tablet use <strong>Download as…</strong> from the bar at the
        bottom of the screen.
      </p>

      <Shot name="ops-daily-reports-download" alt="The Download as window with the four file types and the choices for a PDF." />

      <p>
        Every download is recorded in the <strong>Activity log</strong> under Daily Reports — who downloaded which report, in which
        file type and for which dates. Reading a report on screen is not recorded.
      </p>

      <H2>On a phone or tablet</H2>
      <p>
        Every report can be read on a phone: key figures, the first chart (more on request), and the list as cards that load fifteen
        at a time. Downloading works the same way.
      </p>

      <Pager href="/docs/operations/daily-reports" />
    </>
  )
}
