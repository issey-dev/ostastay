import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Notifications" }

export default function NotificationsGuide() {
  return (
    <>
      <DocTitle
        title="Notifications"
        lead="For everyone: the bell at the top right tells you what needs your attention, so you do not have to go looking for it."
      />

      <p>
        Every signed-in person has a bell in the header, in the dashboard and in the Hub. A small red number on it is how many notifications you have not
        opened yet. Click the bell to see them, newest first.
      </p>

      <H2>Using the bell</H2>
      <ul>
        <li><strong>Click a notification</strong> to open the screen it is about. It is marked as read.</li>
        <li><strong>Mark all read</strong> clears the number in one click.</li>
        <li><strong>Show older</strong> at the bottom of the list loads earlier ones.</li>
        <li>Unread notifications are in bold with a coloured dot: red for urgent, amber for something to act on, grey for information.</li>
        <li>The bell updates when you come back to the window. It does not need the page to be refreshed.</li>
      </ul>

      <H2>Notifications on your phone</H2>
      <p>
        Once the app is <a href="/docs/operations/install-the-app">installed</a>, the bell can also send urgent and action-needed notifications to your phone
        or computer, even when the app is closed. Informational ones, such as the business date moving on, stay in the bell.
      </p>
      <ol>
        <li>Open the bell and, at the bottom of the list, tap <strong>Turn on</strong>.</li>
        <li>Allow notifications when your phone or browser asks.</li>
        <li>Tap a notification to open the app on the right screen.</li>
      </ol>
      <ul>
        <li>This is per device. Turn it on on each phone or computer you want it on, and <strong>Turn off</strong> in the same place.</li>
        <li>Signing out, including being signed out for inactivity, turns it off for that device, so a shared phone or desk computer never shows the next person your alerts.</li>
        <li>On an iPhone or iPad it only works from the app on the Home Screen, not from a Safari tab.</li>
        <li>If you do not see the Turn on button, phone notifications have not been switched on for this system yet. Ask your administrator. The bell works either way.</li>
        <li>Delivery to phones is best effort: a notification can arrive late or, rarely, not at all. The bell always has the full list.</li>
      </ul>

      <H2>What you are told about</H2>
      <p>You only receive what is relevant to you: your own property, and only the kinds of notification your role gives you access to.</p>
      <Table
        head={["Notification", "Who receives it"]}
        rows={[
          ["The business date has moved on (a new day has started)", "Everyone who works at that property"],
          ["Night Audit did not finish or fell behind", "People who have access to Night Audit"],
          ["A new online booking arrived from a booking channel", "People who can create reservations"],
          ["An online booking could not be added and needs a person", "People who can create reservations"],
          ["A channel connection stopped working", "People who manage integrations"],
        ]}
      />
      <Callout title="Good to know">
        <ul>
          <li>You are not notified about something you did yourself.</li>
          <li>Notifications never include guest names or amounts. Open the screen to see the details.</li>
          <li>Setup and the operations dashboard are in the <strong>Account</strong> menu at the bottom of the left-hand menu, where Setup and Operations buttons used to be in the header.</li>
        </ul>
      </Callout>

      <Pager href="/docs/operations/notifications" />
    </>
  )
}
