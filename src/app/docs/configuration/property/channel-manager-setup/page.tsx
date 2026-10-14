import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "Connect your channel manager" }

export default function ChannelManagerSetup() {
  return (
    <>
      <DocTitle
        title="Connect your channel manager"
        lead="Connect a property to your own Beds24 account, so its rooms and prices reach Booking.com, Expedia, Airbnb, Agoda and other online travel agencies, and their bookings arrive as reservations."
      />
      <Where path="Hub › Channel Manager (sidebar)" who="Integrations (create to connect, update to change, delete to disconnect)" />

      <p>
        Beds24 is the channel manager: it holds the connections to the travel agencies. Uppsolut Stay talks to your Beds24 account
        for <strong>one property at a time</strong>, so each property you sell through agencies is connected on its own. The
        connection is made by you, with your own Beds24 account. You do not need to ask Uppsolut.
      </p>
      <Callout title="Prefer Uppsolut to do it?">
        <p>
          A property can instead be connected through Uppsolut&apos;s own Beds24 account. Contact Uppsolut and they will connect it
          for you. It then appears here already connected, and the mapping steps below are the same.
        </p>
      </Callout>

      <H2>Before you start</H2>
      <ul>
        <li>A Beds24 account with this property created in it, and its room types and rates set up there.</li>
        <li>
          This property&apos;s room types, rate plans and prices set up here first (
          <a href="/docs/configuration/property/rooms">step 5</a> and <a href="/docs/configuration/property/rates">step 6</a>).
        </li>
        <li>
          A Hub role with <strong>Integrations</strong> create permission for the property (the Admin role has it). A property
          team member can connect only their own property.
        </li>
        <li>
          Your licence includes channel connections for the property. If you are over the limit, the connection is refused with a
          message saying so.
        </li>
      </ul>

      <H2>1. Get an invite code and the property id from Beds24</H2>
      <p>These two things come from Beds24. Keep the Beds24 page open, because you copy both into Uppsolut Stay next.</p>
      <H3>The invite code</H3>
      <ol>
        <li>Sign in to Beds24.</li>
        <li>
          Open <strong>Settings → Apps &amp; Integrations → API</strong> and choose <strong>Invite codes</strong>.
        </li>
        <li>
          Tick the permissions Uppsolut Stay needs: read and write for <strong>bookings</strong> and for{" "}
          <strong>inventory</strong> (availability and prices), and read for <strong>properties</strong>.
        </li>
        <li>
          Restrict the code to <strong>this property</strong> only, then generate it and copy the code.
        </li>
      </ol>
      <Callout title="One code, one use" tone="warn">
        <p>
          An invite code works once. If you paste it and the connection then fails, or you want to connect another property,
          generate a new code. Generate one code per property.
        </p>
      </Callout>
      <H3>The property id</H3>
      <p>
        In Beds24 open <strong>Settings → Properties</strong>. The property&apos;s number is shown next to its name: that is the
        Beds24 property ID.
      </p>

      <H2>2. Connect the property</H2>
      <p>
        In the Hub choose the property in the sidebar, then <strong>Channel Manager</strong>. A property that is not connected
        shows <strong>Connect to Beds24</strong>.
      </p>
      <Shot name="prop-channel-not-connected" alt="The Channel Manager page of a property that is not connected, with a Connect to Beds24 button." />
      <p>Choose <strong>Connect to Beds24</strong> and fill in the form.</p>
      <Shot name="prop-channel-connect-dialog" alt="The Connect to Beds24 dialog asking for the invite code, the Beds24 property ID and a connection name." />
      <Table
        head={["Field", "What to enter"]}
        rows={[
          ["Invite code", "The code you generated in Beds24. It is checked straight away and then stored encrypted. It is never shown again."],
          ["Beds24 property ID", "The property's number in Beds24 (digits only)."],
          ["Connection name", "A label to tell connections apart. It is suggested for you."],
        ]}
      />
      <p>
        Choose <strong>Connect</strong>. If Beds24 refuses the code, nothing is saved and the page tells you why, so you can fix it
        and try again with a new code. On success the page shows the connection as <strong>Connected</strong>.
      </p>

      <H2>3. Install the webhook</H2>
      <p>
        The webhook is how Beds24 tells Uppsolut Stay about a new, changed or cancelled booking the moment it happens. Without it
        bookings still arrive, but only when the regular check runs.
      </p>
      <Shot name="prop-channel-connected" alt="The Channel Manager page of a connected property, showing its status, the Beds24 property, and the Check, Generate webhook URL, Deep resync and Re-authorize buttons." />
      <ol>
        <li>
          Choose <strong>Generate webhook URL</strong>. The address is shown <strong>once</strong>. Copy it.
        </li>
        <li>
          In Beds24 open <strong>Settings → Properties → Access → Booking webhooks</strong> for this property and paste the address.
          Save.
        </li>
        <li>Back in Uppsolut Stay the badge changes to <strong>Webhook set</strong>.</li>
      </ol>
      <Shot name="prop-channel-webhook-dialog" alt="The webhook URL dialog, which shows the address once with a Copy URL button." />
      <Callout title="Lost the address?" tone="warn">
        <p>
          Only a fingerprint of it is kept, so it cannot be shown again. Choose <strong>Replace webhook URL</strong> to make a new
          one and paste that into Beds24. The old address stops working at once.
        </p>
      </Callout>

      <H2>4. Check the connection</H2>
      <p>
        Choose <strong>Check</strong>. It asks Beds24 for a fresh pass and records the result. The page shows when it was last
        checked, when the credentials were last refreshed, and the Beds24 property it is linked to. If the property id was typed
        wrongly, choose <strong>Change id</strong> next to it. Your mapping is kept.
      </p>
      <Callout title="The 30-day rule" tone="warn">
        <p>
          Beds24 cancels a credential that goes 30 days without being used. Uppsolut Stay refreshes it automatically well before
          then, and the page warns you if it is getting close. If it ever lapses the page says so: choose{" "}
          <strong>Re-authorize</strong>, paste a new invite code from Beds24, and everything else stays as it was.
        </p>
      </Callout>

      <H2>5. Map rooms and rates, then start sharing</H2>
      <p>
        Connecting does not send anything yet. Next, tell Uppsolut Stay which Beds24 room is which of your room types, choose a
        default rate plan for incoming bookings, preview what would be sent, and only then switch sharing on. That is covered on
        the <a href="/docs/configuration/property/channel-manager">Channel manager</a> page.
      </p>
      <Shot name="prop-channel-mapping" alt="The channel manager Mapping page with Sharing, Room type, Rate plan, Inventory and Defaults tabs." />

      <H2>Looking after the connection</H2>
      <Table
        head={["Button or setting", "Use it to"]}
        rows={[
          ["Check", "Test the connection and keep the credentials alive."],
          ["Re-authorize", "Replace the credentials with a new invite code, for example after they lapsed."],
          ["Replace webhook URL", "Make a new webhook address if the old one is lost. Paste it into Beds24 straight after."],
          ["Deep resync", "Re-read bookings from the last hours or days, for example after an outage longer than two days. Safe to repeat: nothing is duplicated."],
          ["Pause syncing at or below", "Optional. Stops sending once your Beds24 account is low on its allowance of requests, so it is never used up. Leave it blank to never pause."],
          ["Booking poll window", "How far back the regular check looks (blank = 48 hours). Leave it unless Uppsolut support asks."],
          ["Disconnect (bin icon)", "Remove the connection, its link to the Beds24 property and the mapping. The property stops sharing straight away. Reconnecting needs a new invite code and the mapping done again."],
        ]}
      />

      <H2>If something goes wrong</H2>
      <Table
        head={["You see", "Try"]}
        rows={[
          ["The connection is refused with an invalid-code message", "Generate a new invite code in Beds24, restricted to this property, and paste it again. Codes work once."],
          ["Status Error after it worked before", "Choose Check to see the last error. If the credentials have lapsed, Re-authorize."],
          ["Bookings are not arriving", "Check the badge says Webhook set, then open Inbound Bookings for a waiting booking and the reason. Run a Deep resync."],
          ["The property already has a connection", "A property has one connection. Disconnect the old one first if you are replacing it."],
          ["Refused: licence limit", "Your licence limits how many properties may use channels. Contact Uppsolut to raise it."],
        ]}
      />
      <p>
        The <strong>Exchange Log</strong> (Channel Manager › Exchange Log) records every message sent to and received from
        Beds24, with secrets removed. Send the entry to Uppsolut support if you need help.
      </p>
      <p>
        Finished? Tick the channel manager line of the <a href="/docs/configuration/go-live">Go-live checklist</a>.
      </p>
      <Pager href="/docs/configuration/property/channel-manager-setup" />
    </>
  )
}
