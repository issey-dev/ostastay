/**
 * The Uppsolut product line, as the marketing pages describe it.
 *
 * ONE SOURCE FOR THREE PAGES. The nav, the company page's product cards, the closing
 * "other products" strip on each detail page and the footer all read from here, so a
 * product cannot end up named one thing in the nav and another on its own page.
 *
 * ON `status`. Only Stay is a shipping product today — it is this repository. POS and
 * Rent Manager are presented as products because the business markets them as such, but
 * they are labelled honestly rather than implied to be live: a prospect who signs up
 * expecting a POS that does not exist yet is a support problem and a credibility problem.
 * Flip a `status` to "Live" the moment that is true.
 *
 * NAMING NOTE FOR THE BRAND OWNER. branding-guide §06 defines the sub-brand architecture
 * as STAY / STOCK / PAY / DESK / RENT, so the guide's names for these two are PAY and
 * RENT. The go-to-market names in use are "POS" and "Rent Manager". Both are carried
 * below — `name` is what the pages say, `mark` is the guide's stacked-lockup word — but
 * that divergence is a decision for the brand owner, not something to paper over here.
 */

export type ProductStatus = "Live" | "In development"

export type Product = {
  /** URL segment under /info. */
  slug: string
  /** Go-to-market name, used in prose and nav. */
  name: string
  /** The word in the stacked brand lockup (guide §06). */
  mark: string
  /** One line, sentence case, no hype. */
  role: string
  summary: string
  status: ProductStatus
  /** Three concrete capabilities — never more; the cards are a scan, not a spec. */
  points: readonly string[]
}

export const PRODUCTS: readonly Product[] = [
  {
    slug: "stay",
    name: "Uppsolut Stay",
    mark: "STAY",
    role: "Property management",
    summary:
      "Reservations through night audit for guesthouses, hotels and resorts. Front desk, housekeeping, revenue and channel distribution in one system.",
    status: "Live",
    points: [
      "Reservations, tape chart and live availability",
      "Housekeeping, maintenance and folio posting",
      "Night audit, cashiering and channel distribution",
    ],
  },
  {
    slug: "pos",
    name: "Uppsolut POS",
    mark: "PAY",
    role: "Retail point of sale",
    summary:
      "Checkout built for a counter that is busy. Thermal receipts, barcode scanning and stock that moves the moment a sale closes.",
    status: "In development",
    points: [
      "Thermal printer and barcode scanner support",
      "Checkout that updates stock immediately",
      "Several terminals against one catalogue",
    ],
  },
  {
    slug: "rent-manager",
    name: "Uppsolut Rent Manager",
    mark: "RENT",
    role: "Rental portfolio management",
    summary:
      "Buildings, units and leases in one structure, with the monthly invoice run handled rather than rebuilt in a spreadsheet every month.",
    status: "In development",
    points: [
      "Building and unit hierarchy",
      "Monthly invoicing on a schedule",
      "Occupancy across the portfolio",
    ],
  },
] as const

export function productBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug)
}

export function otherProducts(slug: string): readonly Product[] {
  return PRODUCTS.filter((p) => p.slug !== slug)
}

/** Where enquiries go. One constant so every CTA on every page agrees. */
export const CONTACT_EMAIL = "hello@uppsolut.com"
