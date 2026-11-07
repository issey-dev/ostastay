import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager } from "../../components"

export const metadata: Metadata = { title: "Install the app" }

export default function InstallTheAppGuide() {
  return (
    <>
      <DocTitle
        title="Install the app"
        lead="For everyone: put Uppsolut Stay on your phone's home screen or your computer, so it opens like an app, full screen, in one tap."
      />

      <p>
        Nothing is downloaded from an app store. The installed app is the same Uppsolut Stay you use in the browser, with the same sign-in and the same
        permissions. It simply opens in its own window without the browser&apos;s address bar. Installing is also what lets the app send notifications to
        your phone: see <a href="/docs/operations/notifications">Notifications</a>.
      </p>

      <H2>Where to find Install app</H2>
      <p>
        The first time you sign in you receive a single notification in the bell, <strong>Install Uppsolut Stay on your phone or computer</strong>. Nothing
        pops up on the screen. Once you have opened that notification, <strong>Install app</strong> appears in your <strong>Account</strong> menu (click your
        name at the bottom of the left-hand menu). It is not shown if the app is already installed.
      </p>
      <p>On Android, Windows and Mac, choosing <strong>Install app</strong> opens your browser&apos;s own install window. On iPhone it shows the steps below.</p>

      <H2>Android (Chrome)</H2>
      <ol>
        <li>Open Uppsolut Stay in Chrome and sign in.</li>
        <li>Open your <strong>Account</strong> menu and choose <strong>Install app</strong>, then confirm.</li>
        <li>Or open Chrome&apos;s <strong>⋮</strong> menu and choose <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li>
      </ol>

      <H2>iPhone and iPad (Safari)</H2>
      <p>iPhones do not offer a one-tap install, so it takes three taps. It must be done in <strong>Safari</strong>, not another browser.</p>
      <ol>
        <li>Open Uppsolut Stay in Safari and sign in.</li>
        <li>Tap the <strong>Share</strong> button.</li>
        <li>Scroll and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
      </ol>
      <Callout title="Notifications on iPhone">
        Phone notifications only work from the app on the Home Screen, never from a Safari tab, and need iOS or iPadOS 16.4 or newer.
      </Callout>

      <H2>Windows and Mac (Chrome or Edge)</H2>
      <ol>
        <li>Open Uppsolut Stay and sign in.</li>
        <li>Open your <strong>Account</strong> menu and choose <strong>Install app</strong>, or click the install icon at the right end of the address bar, or open the browser menu and choose <strong>Install Uppsolut Stay</strong>.</li>
        <li>The app opens in its own window and is added to the Start menu or Applications folder.</li>
      </ol>

      <H2>Good to know</H2>
      <ul>
        <li>The app needs an internet connection, the same as the browser. It does not keep a copy of rooms, rates or balances, so what you see is always current.</li>
        <li>On a shared computer or phone, sign out when you finish, exactly as you would in the browser.</li>
        <li>To remove the app, press and hold its icon (phone) or use the menu inside the app window (computer) and choose <strong>Uninstall</strong>.</li>
        <li>You get the install invitation once, ever. If you do not want it, you can switch off <strong>Invitation to install the app</strong> on the Notifications page, Settings tab. Install app will then not appear in the Account menu, and the browser&apos;s own menu still works.</li>
      </ul>

      <Pager href="/docs/operations/install-the-app" />
    </>
  )
}
