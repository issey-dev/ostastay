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
        your phone when that arrives in a later version.
      </p>

      <H2>Android (Chrome)</H2>
      <ol>
        <li>Open Uppsolut Stay in Chrome and sign in.</li>
        <li>When the <strong>Install Uppsolut Stay</strong> card appears at the bottom of the screen, tap <strong>Install</strong>.</li>
        <li>If you dismissed the card, open Chrome&apos;s <strong>⋮</strong> menu and choose <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li>
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
        <li>Click the install icon at the right end of the address bar, or open the browser menu and choose <strong>Install Uppsolut Stay</strong>.</li>
        <li>The app opens in its own window and is added to the Start menu or Applications folder.</li>
      </ol>

      <H2>Good to know</H2>
      <ul>
        <li>The app needs an internet connection, the same as the browser. It does not keep a copy of rooms, rates or balances, so what you see is always current.</li>
        <li>On a shared computer or phone, sign out when you finish, exactly as you would in the browser.</li>
        <li>To remove the app, press and hold its icon (phone) or use the menu inside the app window (computer) and choose <strong>Uninstall</strong>.</li>
        <li>If the install card keeps getting in your way, tap <strong>Not now</strong>. It stays away for 30 days.</li>
      </ul>

      <Pager href="/docs/operations/install-the-app" />
    </>
  )
}
