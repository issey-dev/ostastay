// The portal's table of contents — the sidebar, the pager and the PDF builder
// (scripts/docs-pdf.ts) all read this, so a new page is added in exactly one place.

export type DocLink = { href: string; title: string; summary: string };
export type DocSection = { title: string; links: DocLink[] };

export const DOC_SECTIONS: DocSection[] = [
  {
    title: "Booking API",
    links: [
      { href: "/docs/api-integration", title: "Overview", summary: "What the Booking API is and how a website uses it." },
      { href: "/docs/api-integration/getting-started", title: "Getting started", summary: "Keys, scopes and your first call." },
      { href: "/docs/api-integration/authentication", title: "Authentication & limits", summary: "Headers, browser use, rate limits, conventions." },
    ],
  },
  {
    title: "Modules",
    links: [
      { href: "/docs/api-integration/rooms", title: "Rooms", summary: "Availability, quotes and room bookings." },
      { href: "/docs/api-integration/excursions", title: "Excursions", summary: "Departures, seats, holds and excursion bookings." },
      { href: "/docs/api-integration/spa", title: "Spa", summary: "Treatments, free times, holds and spa bookings." },
      { href: "/docs/api-integration/bookings", title: "Managing bookings", summary: "Look up and cancel excursion and spa bookings." },
      { href: "/docs/api-integration/webhooks", title: "Webhooks", summary: "Be told when the property changes a booking." },
    ],
  },
  {
    title: "Reference",
    links: [
      { href: "/docs/api-integration/errors", title: "Error codes", summary: "Every error code and what to do about it." },
      { href: "/docs/api-integration/go-live", title: "Go-live checklist", summary: "What to check before the booking page goes public." },
      { href: "/docs/api-integration/changelog", title: "Changelog", summary: "What changed, and when." },
    ],
  },
  {
    title: "Guides for properties",
    links: [
      { href: "/docs/guides/online-booking-setup", title: "Setting up online booking", summary: "For administrators: keys, what is sold online, webhooks." },
      { href: "/docs/guides/front-desk", title: "Online bookings at the desk", summary: "For front office and spa staff: finding and handling online bookings." },
    ],
  },
];

export const ALL_DOC_LINKS: DocLink[] = DOC_SECTIONS.flatMap((s) => s.links);

export const OPENAPI_URL = "/docs/booking-api.openapi.yaml";
export const PDF_URL = "/docs/uppsolut-stay-booking-api-guide.pdf";
/** The address examples use. The real one is the address the property signs in at. */
export const EXAMPLE_BASE = "https://stay.uppsolut.com/api/website/v1";
