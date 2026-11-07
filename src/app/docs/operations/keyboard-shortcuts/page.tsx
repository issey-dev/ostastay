import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Table } from "../../components"
import { FRONT_DESK_KEYS, GO_TO_TARGETS, SHORTCUTS } from "@/lib/shortcuts"

export const metadata: Metadata = { title: "Keyboard shortcuts" }

// Built from src/lib/shortcuts.ts — the same list the cheat sheet (press ?) shows — so this page
// cannot say something the app does not do. Plain words only: no file names or internal terms.

const cap = (k: string) => (k.length === 1 ? k.toUpperCase() : k)

function Keys({ keys, join = "+" }: { keys: string[]; join?: "then" | "+" | "or" }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {keys.map((k, i) => (
        <span key={`${k}-${i}`}>
          {i > 0 && <span> {join === "then" ? "then" : join === "or" ? "or" : "+"} </span>}
          <kbd>{cap(k)}</kbd>
        </span>
      ))}
    </span>
  )
}

export default function KeyboardShortcutsGuide() {
  const everywhere = SHORTCUTS.filter((s) => s.group === "Everywhere")
  const palette = SHORTCUTS.filter((s) => s.group === "Search and commands")
  return (
    <>
      <DocTitle
        title="Keyboard shortcuts"
        lead="For front office, reservations, cashiers and anyone who wants to work faster: find a guest, jump to a page, check someone in or out and post a charge without reaching for the mouse."
      />

      <p>
        Everything here is an <strong>extra</strong>. Every button and menu works exactly as before; the keys are just quicker ways to the same
        screens. Press <kbd>?</kbd> at any time, on any page, to see the list in the app.
      </p>
      <Callout title="Safe by design">
        <ul>
          <li>The single-letter keys only work when nothing is being typed into and no window is open, so they never get in the way of writing a name or a note.</li>
          <li>Nothing that cannot be undone is one keystroke. <strong>Check out</strong> always asks you to confirm first, and there is no key for no-show, cancel or void.</li>
          <li>Each person only sees and can use what their role allows, the same as the menu.</li>
          <li>If the letter keys ever get in your way, you can switch them off (see the end of this page). <kbd>Ctrl</kbd> + <kbd>K</kbd> and <kbd>?</kbd> keep working.</li>
        </ul>
      </Callout>

      <H2>Everywhere</H2>
      <Table
        head={["Keys", "What it does"]}
        rows={everywhere.map((s) => [<Keys key={s.id} keys={s.keys} join={s.join} />, s.label])}
      />

      <H2>Search and commands</H2>
      <p>
        Press <kbd>Ctrl</kbd> + <kbd>K</kbd> (<kbd>⌘</kbd> + <kbd>K</kbd> on a Mac) or <kbd>/</kbd>. Type at least two letters of a guest&apos;s name, a
        confirmation number, a room number or a company, and the matching bookings, rooms and profiles appear. Typing the name of a page
        or an action shows those too, with the shortcut for the page on the right.
      </p>
      <Table
        head={["Keys", "What it does"]}
        rows={palette.map((s) => [<Keys key={s.id} keys={s.keys} join={s.join} />, s.label])}
      />
      <p>
        <strong>Enter</strong> on a booking opens it, as before. Press <kbd>Tab</kbd> (or <kbd>→</kbd>) on a booking instead to see what you can do with it
        right there. The list depends on the booking and on your role:
      </p>
      <Table
        head={["Booking", "What Tab offers"]}
        rows={[
          ["Due in today, no room yet", "Assign room & check in, Folio, Open the booking"],
          ["Due in today, room assigned", "Check in, Folio, Open the booking"],
          ["In-house", "Folio, Post a charge (Fast Post, with the room already chosen), Move room, Check out, Open the booking"],
          ["Checked out, cancelled or no-show", "Open the booking"],
        ]}
      />
      <p>
        Each choice takes you to the screen that already does the job, with its own checks: <strong>Check in</strong> opens the check-in steps (and asks for a
        room first if there is none), <strong>Folio</strong> opens the folio, <strong>Move room</strong> opens the room move and{" "}
        <strong>Post a charge</strong> opens Fast Post on that guest&apos;s room. <strong>Check out</strong> asks &ldquo;Check out this guest?&rdquo; first, and after you
        confirm, the usual messages about an early check-out or an outstanding balance still appear.
      </p>
      <p>The same box also offers these actions, for the roles that can use them:</p>
      <Table
        head={["Action", "What it does"]}
        rows={[
          ["New booking, Walk-in booking", "Start a booking."],
          ["Post a charge, Fast Post", "Open Fast Post to charge a room or a walk-in bill."],
          ["Close shift", "Open Cashiering with the close-shift window ready, where you count the drawer and confirm. If you have no open shift it tells you so."],
          ["Run a report", "Open Daily Reports."],
          ["New guest profile", "Start a guest or company profile."],
          ["Keyboard shortcuts", "Open the cheat sheet."],
        ]}
      />

      <H2>Go to a page: G, then a letter</H2>
      <p>
        Press <kbd>G</kbd>, then one letter. A small note at the bottom of the screen reminds you that it is waiting; if you press nothing for a moment, or
        press <kbd>Esc</kbd>, it is cancelled. You can only reach the pages your role can open.
      </p>
      <Table
        head={["Keys", "Goes to"]}
        rows={GO_TO_TARGETS.map((t) => [<Keys key={t.key} keys={["g", t.key]} join="then" />, t.label])}
      />

      <H2>Front Desk lists</H2>
      <p>
        On the <strong>Front Desk</strong> page, move down the list with <kbd>J</kbd> and up with <kbd>K</kbd>. The highlighted row is the one the
        other keys act on. The keys do nothing while you are typing in the search box, so you can look a guest up and then press <kbd>Esc</kbd> or click the page to go back to the keys.
      </p>
      <Table
        head={["Key", "What it does"]}
        rows={FRONT_DESK_KEYS.map((k) => [<Keys key={k.key} keys={[k.key]} />, k.label])}
      />
      <p>
        A short reminder of the main keys is shown above the list on wide screens. Phones and tablets do not use these keys; they keep the buttons and the
        <strong> …</strong> menu.
      </p>

      <H2>Turning the letter keys off</H2>
      <p>
        Press <kbd>?</kbd>, then use the <strong>Quick keys</strong> switch at the top of the list. It affects the single-letter keys only (the Front Desk list
        keys and <kbd>G</kbd> then a letter). <kbd>Ctrl</kbd> + <kbd>K</kbd>, <kbd>/</kbd> and <kbd>?</kbd> always work. The setting is remembered on that
        computer and browser, so each desk or person can choose for themselves.
      </p>
      <Callout title="Good to know">
        <ul>
          <li>The keys use the English letters printed on the keycaps, so they work with any keyboard layout that has them.</li>
          <li>While a window is open (a check-in, a folio, a confirmation), the letter keys are paused so you can type freely.</li>
          <li>Screen-reader and voice-control users can switch the letter keys off and keep the rest.</li>
        </ul>
      </Callout>

      <Pager href="/docs/operations/keyboard-shortcuts" />
    </>
  )
}
