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
        <a href="/docs/configuration">Configuration guide</a>. More operations guides are on the way.
      </p>
      <Cards
        items={[
          { href: "/docs/operations/front-desk", title: "Online bookings at the desk →", body: "Where bookings from the property's website appear and how to handle them." },
          { href: "/docs/operations/stop-sale", title: "Price calendar and stop sale →", body: "Reading prices on the calendar, closing dates to sale, and overriding a closed date." },
        ]}
      />
      <Pager href="/docs/operations" />
    </>
  )
}
