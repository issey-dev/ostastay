import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "Sessions & support access" }

export default function Security() {
  return (
    <>
      <DocTitle
        title="Sessions & support access"
        lead="See who is signed in, sign someone out, set idle timeouts, and decide when Uppsolut support may look at your data."
      />

      <H2>Sessions</H2>
      <Where path="Hub › Enterprise › Sessions" who="Users & Access (view to see, update to end sessions)" />
      <p>
        <strong>Active sessions</strong> lists everyone signed in right now: their roles, where they are working, when they signed in,
        how long they have been idle, and their browser and IP address. It refreshes every 30 seconds.
      </p>
      <Shot name="ent-sessions" alt="The Active sessions list showing a signed-in user with roles, location, sign-in time, idle time and device." />
      <p>
        Choose <strong>End</strong> on a row and confirm to sign that person out immediately, for example on a shared computer left signed in,
        or when someone leaves. They can sign in again straight away unless you have also changed their password.
      </p>
      <Table
        head={["A session also ends when…", ""]}
        rows={[
          ["The person signs out", ""],
          ["It has been idle longer than the property's idle timeout", "Set per property, see below."],
          ["End of Day rolls the business date", "Staff at that property sign in again for the new day."],
          ["It is 24 hours old", "Whatever else happens."],
        ]}
      />

      <H2>Idle timeout</H2>
      <p>
        The idle timeout is set <strong>per property</strong>, on{" "}
        <a href="/docs/configuration/property/general#idle-sign-out">Property › General › Idle sign-out</a>: Off, 15 minutes, 30
        minutes, 1 hour, 4 hours, or a custom number of minutes (at least 5). Front desks with shared computers should use 15 or 30
        minutes.
      </p>

      <H2 id="support-access">Support access</H2>
      <Where path="Hub › Enterprise › Support Access" who="Property Setup (update to approve)" />
      <p>
        Uppsolut support staff cannot see your data by default. When they need to, for example to investigate a problem you reported,
        they send a request with a reason. It appears here as <strong>PENDING</strong>.
      </p>
      <Shot name="ent-support-access" alt="The Support Access Requests page." />
      <ul>
        <li><strong>Approve</strong> gives support access for 24 hours. It then expires on its own.</li>
        <li><strong>Deny</strong> refuses the request.</li>
        <li><strong>Revoke</strong> ends an approval early, for example when the issue is fixed.</li>
      </ul>
      <Callout>
        <p>
          Approve only requests you expect, with a reason that matches a conversation you had with Uppsolut. Everything support does
          while approved is recorded in the activity log.
        </p>
      </Callout>
      <Pager href="/docs/configuration/enterprise/security" />
    </>
  )
}
