import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "Email & SFTP" }

export default function Email() {
  return (
    <>
      <DocTitle
        title="Email & SFTP"
        lead="Connect the mail account that confirmation letters, eRegistration links and statements are sent from."
      />
      <Where path="Hub › Enterprise › Email & SFTP" who="Property Setup (update to save and test)" />

      <H2>What it is used for</H2>
      <p>One outgoing mail account is shared by every property. Uppsolut Stay uses it to email guests and companies:</p>
      <ul>
        <li>reservation confirmation letters,</li>
        <li>eRegistration links (guests fill in their registration before arrival),</li>
        <li>invoices, receipts and debtor statements.</li>
      </ul>
      <p>
        Until it is set up, the Hub Overview shows <strong>Email is not set up</strong>. If your agreement includes the Uppsolut Mail
        Service, mail goes out through Uppsolut instead. As soon as you enter your own account, yours is used.
      </p>

      <H2>Setting up outgoing email (SMTP)</H2>
      <p>Get these details from whoever runs your email: your IT provider, or your mail host&apos;s help pages.</p>
      <Shot name="ent-email" alt="The SMTP / SFTP card with outgoing email settings, a test box and file transfer settings." />
      <Table
        head={["Field", "What to enter"]}
        rows={[
          ["Host", "The mail server, e.g. smtp.example.com."],
          ["Port", "Usually 587 (with TLS). Some providers use 465."],
          ["Username / Password", "The mailbox login. A saved password shows masked, and leaving it untouched keeps it."],
          ["From Address", "The sender guests see, e.g. reservations@your-hotel.example.com. Use an address your mail server is allowed to send as."],
          ["Use TLS", "Leave on unless your provider says otherwise."],
        ]}
      />
      <ol className="docs-steps">
        <li>Fill in the fields and choose <strong>Save Configuration</strong>.</li>
        <li>In <strong>Test these settings</strong>, choose <strong>Test connection</strong>. This checks the server accepts your login.</li>
        <li>
          Enter your own address in the test box and choose <strong>Send test email</strong>. Check that it arrives, and is not in
          spam. This is the only real proof that guests will receive your mail.
        </li>
      </ol>
      <Callout title="Always test after saving" tone="warn">
        <p>
          The test uses the <em>saved</em> settings. After any change, save first, then test. If a test fails, reload the page to
          check your changes were actually saved.
        </p>
      </Callout>

      <H2>SFTP (file transfer)</H2>
      <p>
        The SFTP section is for sending exports to your own server. It is not in use yet, so you can leave it empty.
      </p>
      <Pager href="/docs/configuration/enterprise/email" />
    </>
  )
}
