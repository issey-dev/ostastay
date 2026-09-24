// The screenshots the Configuration guide shows — one entry per image in public/docs/img.
// Captured by `npm run docs:shots` (scripts/docs-shots.ts) from the fictional Coral Bay
// Hotels enterprise: CBR "Coral Bay Resort" is fully set up, CBL "Coral Bay Lodge" is as
// provisioning leaves a new property. `name` is the file name the page's <Shot> uses.
import type { Page } from "puppeteer";

type Ids = { slug: string; resort: string; lodge: string };
export type Shot = {
  name: string;
  path: (ids: Ids) => string;
  /** Steps before the capture — open a dialog, switch a tab, mark a card. */
  before?: (ctx: { page: Page; ids: Ids }) => Promise<void>;
  /** Capture the open dialog instead of the main content. */
  dialog?: boolean;
  /** Capture this element instead (e.g. "[data-docs-shot]" set by markCard). */
  selector?: string;
  maxHeight?: number;
};

const hub = (ids: Ids, path = "") => `/e/${ids.slug}/hub${path}`;
const ent = (page: string) => (ids: Ids) => hub(ids, `/enterprise/${page}`);
const resort = (section = "") => (ids: Ids) => hub(ids, `/p/${ids.resort}${section ? `/${section}` : ""}`);
const lodge = (section = "") => (ids: Ids) => hub(ids, `/p/${ids.lodge}${section ? `/${section}` : ""}`);

const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

/** Click the first visible button (or tab) whose text starts with `text`. */
async function click(page: Page, text: string, role = "button, [role=tab], a") {
  const ok = await page.evaluate(
    (text, role) => {
      const el = Array.from(document.querySelectorAll<HTMLElement>(role)).find(
        (b) => b.offsetParent !== null && (b.innerText || b.getAttribute("aria-label") || "").trim().startsWith(text)
      );
      el?.click();
      return !!el;
    },
    text,
    role
  );
  if (!ok) throw new Error(`no button "${text}"`);
  await settle();
}

/** Mark the card whose title starts with `title` as the capture target. */
async function markCard(page: Page, title: string) {
  const ok = await page.evaluate((title) => {
    const card = Array.from(document.querySelectorAll<HTMLElement>("[data-slot=card]")).find((c) =>
      (c.querySelector("[data-slot=card-title]")?.textContent ?? "").trim().startsWith(title)
    );
    card?.setAttribute("data-docs-shot", "");
    return !!card;
  }, title);
  if (!ok) throw new Error(`no card "${title}"`);
}

const card = (title: string, first?: (page: Page) => Promise<void>): Pick<Shot, "before" | "selector"> => ({
  selector: "[data-docs-shot]",
  before: async ({ page }) => {
    if (first) await first(page);
    await markCard(page, title);
  },
});

export const SHOTS: Shot[] = [
  // ── Start here ─────────────────────────────────────────────────────────────────
  { name: "hub-overview", path: (ids) => hub(ids) },

  // ── Enterprise ─────────────────────────────────────────────────────────────────
  { name: "ent-properties", path: ent("properties") },
  { name: "ent-property-dialog", path: ent("properties"), dialog: true, before: ({ page }) => click(page, "Add Property") },
  { name: "ent-people", path: ent("people"), ...card("Staff Accounts") },
  { name: "ent-person-dialog", path: ent("people"), dialog: true, before: ({ page }) => click(page, "Add Team Member") },
  { name: "ent-roles", path: ent("people"), ...card("Roles") },
  { name: "ent-role-dialog", path: ent("people"), dialog: true, maxHeight: 1100, before: ({ page }) => click(page, "New Role") },
  { name: "ent-sessions", path: ent("sessions") },
  { name: "ent-email", path: ent("email") },
  { name: "ent-guest-lists", path: ent("lists"), maxHeight: 1000 },
  { name: "ent-booking-api", path: ent("booking-api") },
  { name: "ent-api-key-dialog", path: ent("booking-api"), dialog: true, before: ({ page }) => click(page, "New key") },
  { name: "ent-support-access", path: ent("support-access") },

  // ── Property ───────────────────────────────────────────────────────────────────
  { name: "prop-controls", path: resort() },
  { name: "prop-general", path: resort("general"), ...card("Property Information") },
  { name: "prop-general-idle", path: resort("general"), ...card("Idle Sign-out") },
  { name: "prop-tax", path: resort("finance"), ...card("Tax") },
  { name: "prop-payment-methods", path: resort("finance"), ...card("Payment Methods") },
  { name: "prop-fee-rules", path: resort("finance"), maxHeight: 900, ...card("Deposit") },
  { name: "prop-charge-codes-new", path: lodge("charge-codes"), maxHeight: 1000, ...card("Charge Codes") },
  { name: "prop-charge-code-dialog", path: resort("charge-codes"), dialog: true, before: ({ page }) => click(page, "Add Charge Code") },
  { name: "prop-posting-defaults", path: resort("charge-codes"), ...card("Posting Defaults") },
  { name: "prop-outlets", path: resort("outlets"), ...card("Outlets") },
  { name: "prop-outlet-dialog", path: resort("outlets"), dialog: true, maxHeight: 1000, before: ({ page }) => click(page, "Add Outlet") },
  { name: "prop-room-types", path: resort("inventory"), ...card("Property Architecture") },
  { name: "prop-room-type-dialog", path: resort("inventory"), dialog: true, maxHeight: 1000, before: ({ page }) => click(page, "Add Room Type") },
  { name: "prop-rooms", path: resort("inventory"), ...card("Property Architecture", (page) => click(page, "Rooms", "[role=tab]")) },
  { name: "prop-revenue", path: resort("revenue") },
  { name: "prop-rate-plans", path: (ids) => `/e/${ids.slug}/dashboard/revenue`, maxHeight: 900 },
  { name: "prop-rate-plan-dialog", path: (ids) => `/e/${ids.slug}/dashboard/revenue`, dialog: true, maxHeight: 1000, before: ({ page }) => click(page, "New Rate Plan") },
  { name: "prop-allocations", path: (ids) => `/e/${ids.slug}/dashboard/revenue`, maxHeight: 900, before: ({ page }) => click(page, "Allocations", "[role=tab]") },
  { name: "prop-rate-seasons", path: (ids) => `/e/${ids.slug}/dashboard/revenue`, maxHeight: 1100, before: ({ page }) => click(page, "Rate Seasons", "[role=tab]") },
  { name: "prop-reservations", path: resort("reservations"), ...card("Booking Number Format") },
  { name: "prop-sequences", path: resort("sequences") },
  { name: "prop-night-audit", path: resort("night-audit"), maxHeight: 1400 },
  { name: "prop-stationery", path: resort("stationery"), maxHeight: 1100 },
  { name: "prop-excursions", path: resort("excursions") },
  { name: "prop-spa", path: resort("spa"), maxHeight: 1200 },
  { name: "prop-online-booking", path: resort("online-booking") },
  { name: "prop-channel-mapping", path: resort("channel-manager/mapping") },
  { name: "prop-green-tax", path: resort("green-tax") },
];
