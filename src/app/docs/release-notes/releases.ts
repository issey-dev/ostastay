// Every released version of Uppsolut Stay — rendered by ./page.tsx (the docs portal's
// Release notes area) and into its PDF. Newest first. When you tag a release, add its entry
// at the top: plain language for hotel staff and admins, no internal names, file paths, PR
// numbers or customer names (npm run docs:check guards the obvious ones).

export type Release = {
  version: string
  /** Release date, yyyy-MM-dd. */
  date: string
  highlights?: string
  new?: string[]
  improved?: string[]
  fixed?: string[]
}

export const RELEASES: Release[] = [
  {
    version: "8.3.0",
    date: "2026-09-25",
    highlights: "The desktop app is calmer and quicker to work in: fewer pop-ups, one clear next step after each action, and the same layout on every screen.",
    new: [
      "Search from anywhere with Ctrl+K (or /): find a booking by guest name or confirmation number, a room, a guest profile, or jump to any page you can open.",
      "The reservation page has a summary panel on the right that stays in view: dates, room, balance and the one next step, such as Check in, Settle folio or Check out. Other actions are under More.",
      "The folio can be opened as its own page, so you can keep it in a separate browser tab. Once a stay is settled, the folio offers Check out directly.",
      "Night Audit lists, by name, the bookings that will be marked no-show and waits for you to review them before posting. Each guest still due out has a Folio button.",
      "Price calendar: click a day, then another, to fill the bulk update dates. You can switch rate plans without leaving the calendar.",
      "Tape chart toolbar: Today, jump to a date, and a 7, 14 or 30 day view, with a colour legend.",
      "Lists of profiles, debtors, groups and the Activity Log can be sorted by column, show how many results there are, and can be exported to CSV.",
      "Long Hub setup pages have jump links to each section, and the Hub menu lists every property setup section.",
      "Company and travel agent profiles have a TIN (Tax Identification Number) field.",
      "Green Tax is worked out per guest. Guests under 2, Maldivians and work-permit holders are exempt automatically (the profile shows why), and Night Audit charges only the guests who pay.",
      "The GST report is laid out for the MIRA GST return: one line per invoice, dated on departure, with the agent and their TIN, stay dates, amount excluding tax, service charge, GST, Green Tax and the total.",
    ],
    improved: [
      "Messages after an action appear as a small notice in the top-right corner instead of a pop-up you have to close. Where it helps, the notice has a button for the next step, such as Open folio.",
      "After you save a booking you land on that booking. A walk-in booking goes straight to check-in.",
      "Checking out a guest who still owes money offers to open the folio instead of stopping with an error.",
      "Every page has the same title layout, breadcrumbs on detail pages and a clear browser tab title, so several open tabs are easy to tell apart.",
      "The property name in the header switches property, the business date opens Night Audit, and Setup opens the Hub. The Hub has an Operations link back.",
      "The open tab and list filters are kept in the address bar, so Back and refresh return to the same view. Rows can be opened in a new browser tab.",
      "Cleaner screens: Cashiering is one shift summary with tabs, guest profiles hide empty fields and use tabs, housekeeping cards are neutral with a coloured status stripe, and the tape chart uses softer colours.",
      "Housekeeping: click a room to change its status or complete a task. Use Select for changes to several rooms.",
      "Fast Post searches as you type and remembers the last outlet.",
      "Deleting or voiding anything now asks you to confirm, and actions that need a reason ask for it in the app instead of a browser prompt.",
      "Long forms warn before you leave with unsaved changes. Buttons can't be pressed twice while saving, and Enter submits a dialog.",
      "Hub setup sections have one Save button that is available once you change something, and show \"Saved\" when done. Switches that save on their own show a brief tick.",
      "Button and label wording is consistent across the app.",
    ],
    fixed: [
      "A payment taken during check-in could fail without anyone noticing. You are now told, with a link to the folio.",
      "Checking in from the tape chart now goes through the full check-in steps.",
      "In Housekeeping, Select all no longer includes rooms hidden by the status filter.",
      "The profile list no longer stops at 50 without saying so.",
      "Profile titles show as \"Mrs\" instead of \"MRS\".",
      "A guest added to a stay after the arrival night now gets a Green Tax registration number at the next End of Day.",
    ],
  },
  {
    version: "8.2.0",
    date: "2026-09-25",
    highlights: "Uppsolut Stay now works properly on a phone, across the whole app, and the desktop layout stays exactly as it was.",
    new: [
      "Phone layout across the app. It covers Front Office, Reservations, check-in, folios, Housekeeping, Maintenance, POS, Spa, Excursions, Profiles, the booking form, tape chart, availability, cashiering, debtors, reports, revenue, groups, End of Day and the Activity Log.",
      "A bottom navigation bar on phones that shows only what your role can use, with the business date always in the header.",
      "Dialogs open as bottom sheets on phones, with the title and action buttons pinned in place. Long pick lists and date pickers open as easy-to-scroll drawers.",
      "A redesigned guest eRegistration page on phones. The guest scans their ID first, then works through steps with a progress bar. The Next and Submit buttons stay visible, and the phone's keyboard and autofill match each field.",
      "A \"Report issue\" button in Maintenance, working the same way as reporting an issue from Housekeeping.",
      "Plus and minus steppers for guest counts on phones (booking form, Spa and Excursions).",
      "Hub setup screens and print pages show a \"Best on a larger screen\" notice when opened on a phone.",
      "Release notes in the documentation: what every version added, improved and fixed.",
    ],
    improved: [
      "Payments on a guest folio and a POS walk-in bill are prefilled with the outstanding balance. The amount follows the balance until the cashier types a different one.",
      "Larger tap targets on touch screens. Forms no longer zoom in when a field is tapped on iPhone or iPad.",
      "The folio's Post Charge / Post Payment panel and the Customise Dashboard dialog are easier to use on a phone.",
      "Tables without a phone view now have one, including walk-in bills, payment methods, amenities and email usage.",
      "The booking form shows an error only after you have used a field or tried to save.",
      "The page header now stays pinned while you scroll on desktop.",
    ],
    fixed: [
      "Spa: a therapist's \"Extended hours\" now opens bookable times before the spa opens or after it closes, for the treatments that therapist gives.",
      "The tape chart and the availability grid now open on the property's business date.",
      "The Activity Log's module filter now reads \"All modules\".",
      "Nothing on a phone screen is cut off or needs sideways scrolling any more. Before this release, some buttons could not be reached on a phone.",
      "Booking notifications sent to a website could skip their first delivery attempt. They are now sent straight away.",
    ],
  },
  {
    version: "7.5.0",
    date: "2026-09-24",
    highlights: "A new Configuration guide for your admin team, property logo upload, and many fixes to Hub setup screens.",
    new: [
      "Upload your property logo and crop it to a 3:2 frame. It appears in the app header, on invoices, receipts, statements, confirmation letters, registration cards, reports and emails.",
      "Late arrivals: if a guest checks in after their first night was already audited, check-in shows those held nights. The desk charges them (with service charge and GST, no Green Tax) or waives them with a reason. Waiving needs the same permission as voiding a charge.",
      "The online help is now split into three guides: Booking API (for developers), Configuration (for admins and property teams) and Operations (for staff). The Configuration guide walks through enterprise and property setup in order and ends with a go-live checklist.",
    ],
    improved: [
      "A scheduled Night Audit must be set between 22:00 and 06:00. You get a warning if the audit time means late arrivals that night could be marked No-Show.",
      "A scheduled Night Audit now stops and waits if a cashier drawer is still open, instead of closing it.",
      "New properties start with a clean chart of charge codes: only the system codes they need, with no sample codes. New outlets post to the codes you choose.",
      "\"Copy from another property\" copies charge codes by number and reports anything it skipped. It never links to another property's codes.",
      "Hub setup screens check your input and show clear save errors. This covers properties, people, rooms and room types, revenue, sequences, amenities, Spa and Channel Manager.",
      "Items that already have history cannot be deleted. Tax profiles in use are protected, and deleted list options can be restored.",
      "The price calendar shows the exact price Night Audit will charge. The booking-number preview shows the real next number.",
      "Reactivating a room type brings its rooms back as Dirty.",
      "User passwords need at least 12 characters. Email addresses now work with any capitalisation when signing in.",
    ],
    fixed: [
      "Tax-inclusive charges could come out one cent over the amount entered. They now add up exactly.",
      "A scheduled Night Audit could be stopped by a problem at another property, or not pick up where it left off after a failure. Both are fixed.",
      "Guests checking in a day late now get their Green Tax registration number.",
      "Nationality values saved before the nationality master list now display correctly.",
      "Adding a user in the Hub could fail. This is fixed.",
      "Security hardening of enterprise email and file-transfer settings.",
    ],
  },
  {
    version: "7.3.0",
    date: "2026-09-24",
    highlights: "All setup moves into the Hub, split into Enterprise and Property areas, and Night Audit can now run on a schedule.",
    new: [
      "A reorganised Hub. The Enterprise area holds what every property shares: properties, people, sessions, email and file transfer, Booking API keys, support access, and guest and staff lists. The Property area holds each property's own setup, one property at a time.",
      "Each property now has its own charge codes, taxes, payment methods, dropdown lists, stationery, booking-number format, Green Tax register and online booking settings.",
      "\"Copy from…\" another property, section by section. Anything the property already has is kept and flagged as \"Already here\", never overwritten.",
      "Scheduled Night Audit runs at a set time in the property's own time zone. It stops at any step that needs a person, and the Hub Overview shows it.",
      "No-show options: mark no-shows at the arrival night's audit, hold one night for a late arrival, or leave it to the front desk. You also choose whether the audit posts the no-show fee.",
      "Optional automatic check-out, at Night Audit, of departing guests whose folios are fully settled.",
      "A Night Audit controls page. You can move the business date forward safely, with checks for in-house guests, arrivals, postings, open cashier shifts and activity bookings. You can also switch nightly Green Tax, GST and Service Charge posting on or off.",
      "A built-in nationality and country list with flags, used in every nationality and country field, including eRegistration. Each enterprise can rename entries or add its own.",
    ],
    improved: [
      "The Hub Overview shows only what needs your attention, with a link to fix each item, and a channel-manager status for each property.",
      "Each property has its own channel-manager connection. Uppsolut sets it up, and your team handles mapping, checks, bookings and logs.",
      "A Booking API key covers either one property or all of them.",
      "Job Functions on user profiles are now a fixed list.",
      "Saving one settings page can no longer undo changes made on another.",
    ],
  },
  {
    version: "6.1.0",
    date: "2026-09-23",
    highlights: "A new Operations Dashboard, a Booking API for your own brand website (rooms, Excursions and Spa), and a Green Tax report in the MIRA format.",
    new: [
      "The Operations Dashboard is now the landing page. It shows occupancy, revenue, cashiering, housekeeping, arrivals and departures, Spa, Excursions and more. Each person only sees the sections their role allows, and can arrange their own layout (saved per property).",
      "Booking API for your brand website. Your website can show availability and prices, let guests pick a meal plan and paid extras, and create bookings. Keys are managed in the Hub.",
      "Online booking for Excursions and Spa through the same API, with live availability, short holds, instant booking and guest self-cancellation.",
      "Booking notifications (webhooks) can alert your website when an online booking changes.",
      "Spa appointments now follow a full lifecycle: check-in, start, complete, cancel (with a cutoff and late fee) and no-show (with grace time and fee).",
      "Online bookings are marked on the Spa schedule and the Excursion manifest. A new Online Bookings list shows every attempt.",
      "Green Tax Report in the MIRA information sheet layout, with an Excel export in the government format. A Hub register flags wrongly numbered guests, lets you correct numbers, and marks each month as filed.",
      "A Missing Profile Information report lists guests missing Green Tax details.",
      "Revenue: a \"Define a Rate Season\" tool for setting prices across a date range.",
      "Uppsolut Mail Service (optional add-on): enterprises without their own email server can send guest emails through Uppsolut.",
    ],
    improved: [
      "Reports have a Preview button. PDFs use the app's own styling, and report dates default to the business date.",
      "Reports are picked in two steps: choose a group, then the report.",
      "Dropdowns look the same everywhere and work with the keyboard. Short lists hide the search box.",
      "Booking Method on company and travel agent profiles, and a work-permit tick on ID documents, for Green Tax reporting.",
      "Stays under 12 hours no longer get a Green Tax registration number.",
      "Sessions that have timed out are cleared from the Hub's Active Sessions list.",
      "Thinner, themed scrollbars throughout the app.",
    ],
    fixed: [
      "Some date pickers saved the day before the date you picked. This is fixed.",
      "A sign-in loop, where the browser kept going between the login page and the dashboard, is fixed.",
      "A crash just after signing in to the Hub is fixed.",
      "A crash when switching years in date range pickers is fixed.",
    ],
  },
  {
    version: "6.0.1",
    date: "2026-08-09",
    highlights: "A maintenance release that brings together the 5.9.x work. It has no new features.",
  },
  {
    version: "5.9.5",
    date: "2026-08-09",
    highlights: "Smaller improvements to billing and Hub reports.",
    improved: [
      "Advance Bill: choose the number of nights in a proper dialog. After posting, you can print or email the bill straight away.",
      "The Permission Matrix report prints in landscape and is more compact.",
      "The Hub sidebar now matches the look of the main app.",
    ],
  },
  {
    version: "5.9.0",
    date: "2026-08-09",
    highlights: "The Uppsolut look, a layout that works on phones and tablets, and printed documents you can email or download as PDFs.",
    new: [
      "Invoices, receipts, registration cards, confirmation letters and statements can be emailed or downloaded as a clean PDF from any device.",
      "New enterprises receive their sign-in details by email.",
    ],
    improved: [
      "The Uppsolut brand across the app: colours, logo, sign-in screen and icons.",
      "Printed documents open as clean pages without the app's menus, and lay out properly on a phone.",
      "Admin and setup tables stack into cards on phones and tablets. The Availability grid has a phone view.",
      "Printed documents, emails and Excel exports use consistent brand colours.",
    ],
  },
  {
    version: "5.8.0",
    date: "2026-08-07",
    highlights: "Staff can hold several roles, sessions are properly managed, and eRegistration gains e-signatures and ID scanning.",
    new: [
      "The guest's e-signature from eRegistration prints on the Registration Card.",
      "ID scanning (early version) on the guest eRegistration form. It reads passports and national ID cards to fill in the guest's details automatically, on the device.",
      "Country flags wherever nationality and country are shown.",
      "Staff can hold more than one role. A person's job title is now kept separate from their access role.",
      "Staff administration moved to the Hub, with an Active Sessions list and a printable Permission Matrix report.",
      "Folio routing instructions are chosen from a grouped checklist.",
    ],
    improved: [
      "Resending an eRegistration link can let guests who already submitted update their details. Each slot also has a Reopen button.",
      "Proforma invoices show one line per night.",
      "The product is now called Uppsolut and is available at its new web address.",
    ],
    fixed: [
      "The idle session timeout now signs people out as it should, and the timeout setting saves properly.",
      "A guest resubmitting eRegistration with blank fields could clear details already on file. This is fixed.",
      "Security hardening of the web application.",
    ],
  },
  {
    version: "5.7.0",
    date: "2026-08-04",
    highlights: "A faster, more reliable database platform, clearer folios, and tighter rules for reservations and billing.",
    new: [
      "Folios show charges and payments in one list, with the stay details in a Stay Summary. Proformas show payments already made.",
      "Each folio has a default payment method. Paying with a City Ledger method is what now bills the stay to a company account.",
      "The reservations list has one search box, date modes and a phone layout. Closed bookings are shaded and their actions limited.",
      "Channel booking references are shown on reservations and can be searched.",
      "Numbered charge codes (Group → Subgroup → 4-digit code), with a subgroup for each outlet. Spa and Excursion outlets link to their charge codes.",
      "Spa and Excursions add-ons are enabled for the whole enterprise, not property by property.",
      "An eRegistration button on every arrival row in Front Office.",
      "New properties get their go-live business date at setup, and the dashboard stays locked until the property is active. New users must change their temporary password at first sign-in.",
    ],
    improved: [
      "Reservations can no longer be deleted. Use Cancel instead.",
      "Nothing posts to a folio before check-in, including cancellation and no-show fees. Money taken before arrival is recorded as a deposit.",
      "Booking arrival dates cannot be earlier than the business date.",
      "Front Office, page headers and summary cards are more compact on phones. Info hints replace long subheadings.",
      "The Hub is opened from the Account menu and has its own property switcher.",
      "Improved colours and accessibility throughout.",
    ],
    fixed: [
      "Searches ignore upper and lower case everywhere.",
      "Security hardening of channel-manager connections.",
    ],
  },
  {
    version: "5.6.0",
    date: "2026-07-31",
    highlights: "Channel manager integration, guest self check-in by link, and a proper chart of charge codes.",
    new: [
      "Channel manager integration through the Hub. Connect, check the connection, map room types and rate plans, and send availability and rates. Incoming OTA bookings become reservations, and every exchange is logged.",
      "Guest self check-in by eRegistration link. Guests enter their details, upload an ID photo and sign before arrival. The front desk reviews and applies the details during check-in.",
      "Charge Group → Subgroup → Code structure. Service charge and GST post automatically as linked lines.",
      "Invoices and proformas can be printed in detailed or summary style.",
      "Group blocks: hold rooms by type (taken off availability), link a block to a City Ledger account, route charges to a master folio, and use clearer block statuses with a schedule timeline.",
      "Stop-sale restrictions with an availability grid, and overbooking a room type after a confirmation.",
      "Room move can keep the original room type's rate.",
      "Optional room status updates at Night Audit.",
      "The app version is shown in the Account dialog.",
    ],
    improved: [
      "Front Desk: richer summary cards, reservation-style tables on every tab, a full walk-in booking form and smoother back navigation.",
      "Printed documents take their branding from the property, with redesigned templates and outlet-specific headers.",
      "Payment methods are linked to charge codes, so every posting can be traced.",
      "Housekeeping occupancy follows the business date and shows the guest headcount.",
    ],
    fixed: [
      "After End of Day, everyone signed in to that property is now signed out with a notice, including enterprise admins.",
      "A registration-number problem that could stop check-in after End of Day is fixed.",
    ],
  },
  {
    version: "5.5.0",
    date: "2026-07-26",
    highlights: "A full quality and security review, plus better Spa and Excursions booking screens.",
    new: [
      "Spa and Excursions have the same Book / Schedule / History tabs. The Spa Schedule shows a therapist calendar.",
      "In-house Spa and Excursion bookings can be charged to the room or paid straight away.",
      "Spa search starts from the guest and checks their stay dates. Therapists can be linked to a staff user.",
      "On-screen notifications and consistent confirmation prompts for actions that cannot be undone.",
    ],
    improved: [
      "Guards against double posting: Night Audit, Advance Bills, check-out, cancellation and reversals can no longer run twice at the same time.",
      "More accurate money totals for balances and cashier drawers. Currency exchange now balances the drawer.",
      "Spa and Excursion capacity is enforced, and departures that have already left cannot be booked.",
      "Early check-in before the arrival date is blocked.",
      "Clear error messages when a list fails to load. Long lists are searchable.",
    ],
    fixed: [
      "Security hardening of access controls and of stored email and file-transfer passwords.",
    ],
  },
  {
    version: "5.4.0",
    date: "2026-07-25",
    highlights: "Point of Sale becomes Fast Post, focused on quick charges to guests and walk-ins.",
    new: [
      "Fast Post (formerly Point of Sale). Walk-in bills open in a window with Tax Invoice, Void Bill and Payment. A History tab lists closed bills, which can be reopened on the same business day.",
    ],
    improved: [
      "Fast Post only finds in-house guests when posting to a room.",
    ],
  },
  {
    version: "5.3.0",
    date: "2026-07-25",
    highlights: "A guided check-in and a configurable Registration Card.",
    new: [
      "A step-by-step check-in: Room, Identification, Registration Card, Confirm.",
      "A themed Registration Card you can set up yourself.",
      "The Green Tax registration number is shown on the reservation.",
    ],
  },
  {
    version: "5.2.0",
    date: "2026-07-25",
    highlights: "Billing tools for the whole stay.",
    new: [
      "Reverse a check-in or check-out.",
      "Interim Bill (a mid-stay statement) and Advance Bill (post upcoming nights in advance).",
      "Several named fee rules of each type, chosen per reservation.",
      "Named routing targets and a Travel Agent folio.",
      "Reservations show Due In and Due Out states automatically.",
    ],
    improved: [
      "Check-out enforces settlement rules. Check-in is only allowed when the booking is ready.",
    ],
  },
  {
    version: "5.1.0",
    date: "2026-07-24",
    highlights: "The first numbered release. It brings a redesigned reservation screen, the Spa module and a guided End of Day.",
    new: [
      "A redesigned reservation detail screen, with Transport and Daily Details.",
      "Traces with an \"alert on open\" pop-up when a reservation is opened.",
      "The Spa module: treatments, therapists, rooms, availability, in-house and walk-in bookings, therapist requests and preferences.",
      "The Excursions module, with a calendar view.",
      "Each property has its own business date, which drives check-in and check-out, posting and End of Day.",
      "A step-by-step End of Day with snapshot reports, a per-date archive and Green Tax registration numbering.",
      "A reporting engine with Front Desk, Reservations, Revenue, Financial and Housekeeping reports.",
      "Folio routing instructions, and moving charges between folios and rooms. Deposit, cancellation and no-show fee rules.",
    ],
    improved: [
      "Proforma invoices include the full projected cost of the stay, transport included.",
      "Cashier shifts are tied to each user, property and business date.",
      "A new icon set and a combined account and property menu.",
    ],
  },
]

/** The builds before numbered releases (July 2026). */
export const EARLIER_DEVELOPMENT = {
  title: "Earlier development — July 2026",
  intro: "The first builds before numbered releases. They set up the core hotel system:",
  items: [
    "Several properties under one enterprise, with role-based access.",
    "Reservations with a tape chart, group blocks, a front desk, housekeeping, maintenance and cashiering.",
    "Guest profiles with communications, identification, preferences and VIP levels.",
    "Revenue management: base rates, occupancy pricing, derived and negotiated rate plans, meal plans and allocations.",
    "Outlets and walk-in billing, custom tax profiles, Green Tax posting, a debtors module, confirmation letters and printed invoices and receipts.",
  ],
}

/** The heading anchor for a version: 8.2.0 → "v8-2-0". */
export const releaseAnchor = (version: string) => `v${version.replace(/\./g, "-")}`
