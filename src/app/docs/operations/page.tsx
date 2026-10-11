import type { Metadata } from "next"
import { Cards, DocTitle, Pager } from "../components"

export const metadata: Metadata = { title: "Operations" }

export default function OperationsOverview() {
  return (
    <>
      <DocTitle
        title="Operations"
        lead="Day-to-day guides for the people who run the property: front office, reservations, cashiering, excursions, spa and the night audit."
      />
      <p>
        These guides assume the property has been set up. If it has not, start with the{" "}
        <a href="/docs/configuration">Configuration guide</a>. 
      </p>
      <Cards
        items={[
          { href: "/docs/operations/desk", title: "Front Desk, Reservations and Tape Chart →", body: "The daily screens, badges and buttons, moving guests between rooms and split stays." },
          { href: "/docs/operations/groups-and-clients", title: "Group blocks and Client Relations →", body: "The group's Posting Master, profiles, deactivating and eRegistration." },
          { href: "/docs/operations/front-desk", title: "Online bookings at the desk →", body: "Where bookings from the property's website appear and how to handle them." },
          { href: "/docs/operations/daily-reports", title: "Daily Reports →", body: "Reading a report with its figures and charts, and downloading it as PDF, Excel, delimited text or CSV." },
          { href: "/docs/operations/stop-sale", title: "Price calendar and stop sale →", body: "Reading prices on the calendar, closing dates to sale, and overriding a closed date." },
        ]}
      />
      <Pager href="/docs/operations" />
    </>
  )
}
