import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "People & roles" }

export default function People() {
  return (
    <>
      <DocTitle
        title="People & roles"
        lead="Give every member of staff their own account, decide what they can do with roles, and where they work with their access."
      />
      <Where path="Hub › Enterprise › People" who="Users & Access permission, all-properties users only" />

      <H2>How access works</H2>
      <p>Three things decide what a person can do:</p>
      <Table
        head={["Setting", "Decides"]}
        rows={[
          [<strong key="r">Roles</strong>, "What they can do: which modules they can view, create, update or delete in. A person can hold several roles; their access is the combination of all of them."],
          [<strong key="a">Access</strong>, "Where they can do it: All Properties (enterprise-wide), or a Single Property, their work location. There is nothing in between."],
          [<strong key="j">Job function</strong>, "Their post at the property. It does not grant anything, but Housekeeping and Maintenance decide who appears in the room-assignment and work-order pickers."],
        ]}
      />
      <p>
        Plan roles around jobs, not people. Create roles first, then add people and tick the roles they need.
      </p>

      <H2>Roles</H2>
      <p>
        The <strong>Roles &amp; permissions</strong> card lists every role and how many people hold it. Seven built-in roles are
        ready to use and cannot be changed:
      </p>
      <Table
        head={["Built-in role", "Can do"]}
        rows={[
          ["Admin, Manager", "Everything, including setup and user management."],
          ["Front Desk", "Front office, reservations, group blocks, tape chart, availability, profiles, housekeeping, maintenance, cashiering, Fast Post, night audit, excursions and spa: create and update, but not delete."],
          ["Reservations", "Reservations, tape chart and availability; group blocks and profiles without delete; front desk view."],
          ["Cashier", "Cashiering; Fast Post, debtors and profiles without delete; front desk view."],
          ["Housekeeping", "Housekeeping; maintenance view."],
          ["Maintenance", "Maintenance; housekeeping view."],
        ]}
      />
      <p>None of the operational roles can open the Hub. Give setup work only to people who need it.</p>
      <Shot name="ent-roles" alt="The Roles & Permissions card listing built-in roles and a custom Night Manager role with the number of users assigned." />

      <H3>Creating a role</H3>
      <p>
        Choose <strong>Add role</strong>, give it a <strong>Role name</strong> (unique in your enterprise), and tick what it may do
        in each module:
      </p>
      <Shot name="ent-role-dialog" alt="The Add role dialog: a role name field and a permission grid of modules against View, Create, Update, Delete and Full access." />
      <ul>
        <li>
          <strong>Property modules</strong> are day-to-day work: Front Desk, Reservations, Cashiering, Night Audit, Revenue, Daily
          Reports, Excursions, Spa, Dashboard and the rest.
        </li>
        <li>
          <strong>Hub modules</strong> are setup and administration: <strong>Property Setup</strong> (every Controls page),{" "}
          <strong>Integrations</strong> (Booking API, online booking, channel manager), <strong>Users &amp; Access</strong> and{" "}
          <strong>Green Tax Registrations</strong>. Users &amp; Access only works for all-properties users. A single-property user
          with Property Setup can configure their own property only.
        </li>
        <li>
          Ticking <strong>Dashboard</strong> view shows a <strong>Dashboard widgets</strong> panel to choose which cards the role
          sees. It hides cards; it does not restrict data.
        </li>
      </ul>
      <p>
        Choose <strong>Create</strong> (or <strong>Save</strong> when you edit a role). Deleting a role asks you to confirm first,
        and a role that people still hold cannot be deleted. To print who can do what, choose{" "}
        <strong>Permission matrix report</strong> at the top of the page: an A4 matrix of every role, plus the people who hold each.
      </p>

      <H2>Staff accounts</H2>
      <Shot name="ent-people" alt="The Staff Accounts card listing staff with their roles, post, access and status." />
      <p>Choose <strong>Add team member</strong>, fill in the form and choose <strong>Create</strong>:</p>
      <Shot name="ent-person-dialog" alt="The Add team member dialog: first and last name, email, password, roles, job function and access." />
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["First name, Last name", "Both required."],
          ["Email address", "The person signs in with it. It must be unique across Uppsolut Stay, and is saved in lower case."],
          ["Password", "At least 12 characters. Give it to the person privately. When editing, leave it blank to keep the current one."],
          ["Roles", "At least one."],
          ["Job function", "Optional: Management, Front Office, Reservations, Cashier, Housekeeping, Maintenance, Food & Beverage, Spa."],
          ["Access", "All properties, or Single property with a Work location."],
          ["Active", "When editing. Switch off to stop the person signing in; their sessions end at once. The onboarding account is always active."],
        ]}
      />
      <Callout title="Good practice">
        <p>One account per person. Never share an account: the activity log records who did what.</p>
      </Callout>

      <H3>When someone leaves</H3>
      <p>
        Edit their account and switch <strong>Active</strong> off. They are signed out at once and can&apos;t sign in again, and
        everything they did stays in the history. An account that has never been used can be deleted (you are asked to confirm); one with history (for
        example a cashier shift) can only be deactivated.
      </p>
      <p>To reset a forgotten password, edit the person and type a new password.</p>
      <Pager href="/docs/configuration/enterprise/people" />
    </>
  )
}
