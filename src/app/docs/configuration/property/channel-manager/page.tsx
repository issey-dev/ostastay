import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "Channel manager" }

export default function ChannelManager() {
  return (
    <>
      <DocTitle
        title="Channel manager"
        lead="Share availability and prices with online travel agencies through your channel manager, and receive their bookings as reservations."
      />
      <Where path="Hub › Channel Manager (sidebar)" who="Integrations (update to change mapping and send)" />

      <H2>1. The connection</H2>
      <p>
        Uppsolut connects your property to the channel manager; you can&apos;t do this yourself. Until then the page says the
        property is not connected: contact Uppsolut to request it. Once connected, the <strong>Channel Manager</strong> page shows{" "}
        <strong>Connected</strong>, when it was last checked, and whether the inbound webhook is installed. <strong>Check</strong>{" "}
        tests the connection.
      </p>
      <p>Before mapping, set up room types, rate plans and prices (<a href="/docs/configuration/property/rooms">steps 5</a> and <a href="/docs/configuration/property/rates">6</a>), and create the same room types and rates in your channel-manager account.</p>

      <H2>2. Mapping</H2>
      <Where path="Hub › Channel Manager › Mapping" />
      <Shot name="prop-channel-mapping" alt="The channel manager Mapping page with Sharing, Room type, Rate plan, Inventory and Defaults tabs." />
      <Table
        head={["Tab", "What to do"]}
        rows={[
          ["Room type", "Enter the channel manager's room ID next to each room type; it saves when you leave the field. Switch Share off to hold a room type back. Pseudo room types can't be mapped."],
          ["Rate plan", "Optionally map rate plans to a price slot (1–16) in the channel manager."],
          ["Defaults", "Choose the Default rate plan (required) and Default meal plan for incoming bookings, then Save."],
          ["Inventory", "Resync sends availability again, with a preview first."],
          ["Sharing", "The Share switch. It can only be switched on once every active room type is mapped."],
        ]}
      />
      <Callout title="Choose a default rate plan" tone="warn">
        <p>
          Incoming bookings are turned into reservations automatically, but only once a <strong>Default rate plan</strong> is chosen
          and their room type is mapped. Until then they wait, unconverted, on the Inbound Bookings page.
        </p>
      </Callout>
      <H3>Checking before you share</H3>
      <p>
        Use <strong>Send prices for a date range</strong> (Rate plan tab) or <strong>Resync</strong> (Inventory tab) to preview
        exactly what would be sent: × for stop-sell, 0 for sold out, — for no price, and a list of room types not published and why.
        When it looks right, switch <strong>Share</strong> on. From then on availability and prices are sent automatically, a year
        ahead.
      </p>

      <H2>3. Inbound Bookings and the Exchange Log</H2>
      <ul>
        <li>
          <strong>Inbound Bookings</strong> lists bookings received from the channel manager and what became of each: the
          reservation it created, or why it is waiting (such as an unmapped room or no default rate plan). Waiting bookings are
          retried automatically once fixed. An <strong>Overbooking</strong> badge means
          more rooms were sold than you have. Resolve it before arrival, then <strong>Acknowledge</strong> it.
        </li>
        <li><strong>Exchange Log</strong> records every message sent and received, for troubleshooting with Uppsolut.</li>
      </ul>
      <Pager href="/docs/configuration/property/channel-manager" />
    </>
  )
}
