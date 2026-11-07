import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "Announcements" }

export default function Announcements() {
  return (
    <>
      <DocTitle
        title="Announcements"
        lead="Send a message to everyone in the enterprise, or to one property. It arrives in each person's notification bell, and on their phone if they have turned that on."
      />
      <Where path="Hub › Enterprise › Announcements" who="Property Setup (update to send)" />

      <H2>Sending one</H2>
      <ol className="docs-steps">
        <li>Choose <strong>Who is it for</strong>: <strong>Everyone, all properties</strong>, or one property.</li>
        <li>Write a short <strong>Title</strong> (up to 80 characters). This is what people see first.</li>
        <li>Optionally add a <strong>Message</strong> (up to 500 characters).</li>
        <li>Choose <strong>Send announcement</strong>. A message at the top tells you how many people it reached.</li>
      </ol>
      <p>
        You are not sent your own announcement. Only active people receive it. Choosing a property reaches the people who work at that
        property and the people who work across the whole enterprise.
      </p>

      <H2>What people see</H2>
      <ul>
        <li>A new item in the bell, with the title and message, and a red count until they open it.</li>
        <li>A notification on their phone or computer if they installed the app and turned phone notifications on.</li>
        <li>Announcements <strong>cannot be switched off</strong> in the bell, so an important notice is never silently missed. People can still choose whether it also goes to their phone.</li>
      </ul>

      <H2>Who has read it</H2>
      <p>
        Under <strong>Sent</strong> you see the latest announcements, who they were for, when they were sent, and <strong>read by</strong> a number
        out of the number of people who received it.
      </p>
      <Table
        head={["Column", "Meaning"]}
        rows={[
          ["Who it was for", "Everyone, or the property's name."],
          ["Read by 4 of 12", "Four of the twelve people it reached have opened it in the bell."],
        ]}
      />

      <Callout title="Keep it safe to read on a lock screen" tone="warn">
        <p>
          Announcements can appear on a phone&apos;s lock screen. Do not put guest names, room numbers with names, amounts or passwords in them.
        </p>
      </Callout>
      <Callout title="Good to know">
        <ul>
          <li>An announcement cannot be edited or recalled once sent. Send a follow-up instead.</li>
          <li>Sending the same message twice within a minute only sends it once.</li>
          <li>Each announcement is recorded in the Activity Log.</li>
          <li>Uppsolut support cannot send announcements from a support session.</li>
        </ul>
      </Callout>

      <Pager href="/docs/configuration/enterprise/announcements" />
    </>
  )
}
