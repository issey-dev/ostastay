import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table } from "../../components"

export const metadata: Metadata = { title: "Before you begin" }

export default function GettingStarted() {
  return (
    <>
      <DocTitle
        title="Before you begin"
        lead="Signing in for the first time, setting your password, and finding your way around the Hub."
      />

      <H2>What Uppsolut sends you</H2>
      <p>When your enterprise is provisioned, your first administrator receives a welcome email with:</p>
      <Table
        head={["Item", "What it is"]}
        rows={[
          ["Sign-in address", "The address you sign in at, ending in /login."],
          ["Enterprise code", "Your enterprise's short code, for example coralbay. Everyone in your enterprise uses the same code."],
          ["Email", "Your account's email address."],
          ["Temporary password", "Valid for your first sign-in only. You choose your own password straight away."],
        ]}
      />
      <p>
        This first account is your <strong>onboarding account</strong>. It always has full access to every property, and it cannot
        be deleted or restricted, so your enterprise can never lock itself out. You can still change its name, email and password.
      </p>

      <H2>First sign-in</H2>
      <ol className="docs-steps">
        <li>Open the sign-in address. Enter the <strong>Enterprise code</strong>, your <strong>Email</strong> and the temporary <strong>Password</strong>, then choose <strong>Sign in</strong>.</li>
        <li>
          The <strong>Set your password</strong> screen opens. Enter a <strong>New password</strong> of at least 12 characters (not
          the temporary one), confirm it, and choose <strong>Set password and continue</strong>.
        </li>
        <li>You are signed in and land on the property dashboard, the day-to-day side of Uppsolut Stay.</li>
      </ol>
      <Callout title="Signing in problems" tone="warn">
        <p>
          Every failed sign-in shows the same message, whatever was wrong. After five failed attempts in 15 minutes the account is
          locked for 15 minutes. There is no &quot;forgot password&quot; link: a user who forgets their password asks an
          administrator to set a new one in <strong>People</strong>.
        </p>
      </Callout>

      <H2>Opening the Hub</H2>
      <p>
        All configuration is in the Hub. From the dashboard, choose <strong>Setup</strong> at the top right of the header, or open
        the account menu at the bottom of the sidebar (your name) and choose <strong>Hub</strong>. Both are shown only to people who
        have setup permissions. To go back, choose <strong>Operations</strong> at the top right of the Hub, or open the account menu
        in the Hub&apos;s sidebar and choose <strong>Open property dashboard</strong>.
      </p>

      <H3>The Hub sidebar</H3>
      <Table
        head={["Group", "What is in it"]}
        rows={[
          ["Overview", "What still needs attention across the enterprise and every property."],
          ["Enterprise", "Properties, People, Sessions, Email & SFTP, Booking API Keys, Support Access, Guest Lists."],
          [
            "Property",
            "Controls (the property's setup pages) and Channel Manager. Controls opens into a list of the property's setup sections, so you can move from one section to the next without going back to the Controls page. A band at the top of every property page reads Configuring · property name, with a switcher to change property.",
          ],
        ]}
      />
      <p>
        Longer setup pages, with three or more sections, show links under the page title that jump straight to each section.
      </p>
      <p>
        You only see the menu items your roles allow. Staff who work at a single property never see the Enterprise group. They can
        still reach their own property&apos;s setup if their role includes Property Setup.
      </p>

      <H2>The Overview page</H2>
      <p>
        The Hub opens on <strong>Overview</strong>. It lists what is missing or wrong, most urgent first. Each item has a button
        that takes you to the page that fixes it. A new property shows several items. That is expected, and they go away as you work
        through this guide.
      </p>
      <Shot
        name="hub-overview"
        alt="The Hub Overview page listing items that need attention: a property with no room types, no payment methods, no invoice payment details and no City Ledger settlement method, and email not set up."
        caption="A newly provisioned property on the Overview. Red items block operations, amber items are warnings."
      />
      <p>
        When everything is in place, the page says <strong>Everything is set up — nothing needs attention</strong>. Come back to it
        whenever you are unsure what is left.
      </p>

      <H2>Permissions you need</H2>
      <p>The built-in <strong>Admin</strong> role has everything. If you give setup work to others, the Hub pages need these permissions:</p>
      <Table
        head={["Permission", "Opens"]}
        rows={[
          ["Property Setup", "Every property page under Controls, and the enterprise Properties, Email & SFTP, Support Access and Guest Lists pages."],
          ["Users & Access", "People and Sessions (enterprise-wide users only)."],
          ["Integrations", "Booking API Keys, Online Booking and Channel Manager."],
          ["Green Tax Registrations", "The Green Tax register."],
          ["Revenue", "Saving meal plans, rate plans, allocations and prices."],
          ["Night Audit (update)", "Changing the business date."],
        ]}
      />
      <Pager href="/docs/configuration/getting-started" />
    </>
  )
}
