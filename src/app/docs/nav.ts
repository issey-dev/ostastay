// The portal's table of contents — the header, the sidebar, the pager and the PDF builder
// (scripts/docs-pdf.ts) all read this, so a new page is added in exactly one place.
//
// The portal is split into AREAS, each with its own sidebar, pager and PDF:
//   /docs/api            — the Booking API, for web developers
//   /docs/configuration  — setting up an enterprise and its properties in the Hub
//   /docs/operations     — day-to-day use by property staff
//   /docs/release-notes  — what each version added, improved and fixed
// The old /docs/api-integration and /docs/guides/* addresses redirect (next.config.ts).

export type DocLink = { href: string; title: string; summary: string };
export type DocSection = { title: string; links: DocLink[] };
export type DocArea = {
  key: "api" | "configuration" | "operations" | "release-notes";
  title: string;
  href: string;
  audience: string;
  sections: DocSection[];
  /** The area's downloadable PDF, built by `npm run docs:pdf`. */
  pdf: { url: string; title: string };
};

export const DOC_AREAS: DocArea[] = [
  {
    key: "api",
    title: "Booking API",
    href: "/docs/api",
    audience: "For web developers",
    pdf: { url: "/docs/uppsolut-stay-booking-api-guide.pdf", title: "Booking API guide" },
    sections: [
      {
        title: "Booking API",
        links: [
          { href: "/docs/api", title: "Overview", summary: "What the Booking API is and how a website uses it." },
          { href: "/docs/api/getting-started", title: "Getting started", summary: "Keys, scopes and your first call." },
          { href: "/docs/api/authentication", title: "Authentication & limits", summary: "Headers, browser use, rate limits, conventions." },
        ],
      },
      {
        title: "Modules",
        links: [
          { href: "/docs/api/rooms", title: "Rooms", summary: "Availability, quotes and room bookings." },
          { href: "/docs/api/excursions", title: "Excursions", summary: "Departures, seats, holds and excursion bookings." },
          { href: "/docs/api/spa", title: "Spa", summary: "Treatments, free times, holds and spa bookings." },
          { href: "/docs/api/bookings", title: "Managing bookings", summary: "Look up and cancel excursion and spa bookings." },
          { href: "/docs/api/webhooks", title: "Webhooks", summary: "Be told when the property changes a booking." },
        ],
      },
      {
        title: "Reference",
        links: [
          { href: "/docs/api/errors", title: "Error codes", summary: "Every error code and what to do about it." },
          { href: "/docs/api/go-live", title: "Go-live checklist", summary: "What to check before the booking page goes public." },
          { href: "/docs/api/changelog", title: "Changelog", summary: "What changed, and when." },
        ],
      },
    ],
  },
  {
    key: "configuration",
    title: "Configuration",
    href: "/docs/configuration",
    audience: "For administrators and property teams",
    pdf: { url: "/docs/uppsolut-stay-configuration-guide.pdf", title: "Configuration guide" },
    sections: [
      {
        title: "Start here",
        links: [
          { href: "/docs/configuration", title: "Overview", summary: "Who does what, the two setup areas, and the order to work in." },
          { href: "/docs/configuration/getting-started", title: "Before you begin", summary: "First sign-in, your password, and finding your way around the Hub." },
        ],
      },
      {
        title: "Enterprise setup",
        links: [
          { href: "/docs/configuration/enterprise", title: "Enterprise & properties", summary: "The enterprise area, and adding a property." },
          { href: "/docs/configuration/enterprise/people", title: "People & roles", summary: "Staff accounts, roles, permissions and work locations." },
          { href: "/docs/configuration/enterprise/security", title: "Sessions & support access", summary: "Who is signed in, signing people out, and letting Uppsolut support in." },
          { href: "/docs/configuration/enterprise/email", title: "Email & SFTP", summary: "The mail account guest emails are sent from." },
          { href: "/docs/configuration/enterprise/guest-lists", title: "Guest lists", summary: "Nationalities, titles, VIP levels and the other guest-profile lists." },
          { href: "/docs/configuration/enterprise/booking-api", title: "Booking API keys", summary: "Keys and webhooks for your own website." },
        ],
      },
      {
        title: "Property setup",
        links: [
          { href: "/docs/configuration/property", title: "Property setup overview", summary: "What a new property already has, and the setup order." },
          { href: "/docs/configuration/property/general", title: "1. General", summary: "Name, address, logo, times, appearance and idle sign-out." },
          { href: "/docs/configuration/property/finance", title: "2. Tax & payments", summary: "Tax rates, payment methods, cashier defaults and fee rules." },
          { href: "/docs/configuration/property/charge-codes", title: "3. Charge codes", summary: "The chart of accounts: groups, codes and what each code generates." },
          { href: "/docs/configuration/property/outlets", title: "4. Outlets", summary: "Restaurants, bars and shops, and the amenities guests see." },
          { href: "/docs/configuration/property/rooms", title: "5. Rooms & inventory", summary: "Room features, room types, buildings, floors and rooms." },
          { href: "/docs/configuration/property/rates", title: "6. Rates & packages", summary: "Rate plans, prices, allocations and meal plans." },
          { href: "/docs/configuration/property/reservations", title: "7. Reservations & numbering", summary: "Booking numbers, document sequences and reservation lists." },
          { href: "/docs/configuration/property/night-audit", title: "8. Night audit", summary: "Business date, nightly postings, no-shows and the audit schedule." },
          { href: "/docs/configuration/property/stationery", title: "9. Stationery", summary: "Invoices, receipts, letters, registration card and eRegistration." },
          { href: "/docs/configuration/property/excursions", title: "Excursions", summary: "Add-on: the excursion catalogue, prices and departures." },
          { href: "/docs/configuration/property/spa", title: "Spa", summary: "Add-on: treatments, therapists, treatment rooms and spa policies." },
          { href: "/docs/configuration/property/online-booking", title: "Online booking", summary: "What the property's own website shows and sells." },
          { href: "/docs/configuration/property/channel-manager", title: "Channel manager", summary: "Mapping rooms and rates to online travel agencies." },
          { href: "/docs/configuration/property/green-tax", title: "Green Tax register", summary: "Checking and filing the monthly Green Tax register." },
        ],
      },
      {
        title: "Finish",
        links: [
          { href: "/docs/configuration/go-live", title: "Go-live checklist", summary: "Everything to confirm before the first real guest." },
        ],
      },
    ],
  },
  {
    key: "operations",
    title: "Operations",
    href: "/docs/operations",
    audience: "For property staff",
    pdf: { url: "/docs/uppsolut-stay-operations-guide.pdf", title: "Operations guide" },
    sections: [
      {
        title: "Operations",
        links: [
          { href: "/docs/operations", title: "Overview", summary: "Day-to-day guides for property staff." },
          { href: "/docs/operations/front-desk", title: "Online bookings at the desk", summary: "For front office and spa staff: finding and handling online bookings." },
        ],
      },
    ],
  },
  {
    key: "release-notes",
    title: "Release notes",
    href: "/docs/release-notes",
    audience: "For everyone",
    pdf: { url: "/docs/uppsolut-stay-release-notes.pdf", title: "Release notes" },
    sections: [
      {
        title: "Release notes",
        links: [
          { href: "/docs/release-notes", title: "All releases", summary: "What each version added, improved and fixed." },
        ],
      },
    ],
  },
];

export const areaLinks = (area: DocArea): DocLink[] => area.sections.flatMap((s) => s.links);

/** The area a docs path belongs to, or null for the portal home. */
export function areaFor(pathname: string): DocArea | null {
  return DOC_AREAS.find((a) => pathname === a.href || pathname.startsWith(`${a.href}/`)) ?? null;
}

export const ALL_DOC_LINKS: DocLink[] = DOC_AREAS.flatMap(areaLinks);

export const OPENAPI_URL = "/docs/booking-api.openapi.yaml";
/** The Booking API guide — kept at its original address, which is already shared. */
export const PDF_URL = DOC_AREAS[0].pdf.url;
/** The address examples use. The real one is the address the property signs in at. */
export const EXAMPLE_BASE = "https://stay.uppsolut.com/api/website/v1";
