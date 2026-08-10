import type { Metadata } from "next"
import { productBySlug } from "../products"
import { ProductPage, type ProductPageContent } from "../product-page"

const product = productBySlug("rent-manager")!

const DESCRIPTION =
  "Uppsolut Rent Manager is rental portfolio software in development — buildings and units in one hierarchy, leases, scheduled monthly invoicing and occupancy across the portfolio."

export const metadata: Metadata = {
  title: "Uppsolut Rent Manager — rental portfolio management",
  description: DESCRIPTION,
  keywords: [
    "rental management software",
    "property portfolio software",
    "lease management",
    "rent invoicing",
    "occupancy reporting",
    "landlord software",
    "Uppsolut Rent Manager",
  ],
  alternates: { canonical: "/info/rent-manager" },
  openGraph: {
    type: "website",
    url: "/info/rent-manager",
    title: "Uppsolut Rent Manager — rental portfolio management",
    description: DESCRIPTION,
    siteName: "Uppsolut",
  },
  twitter: { card: "summary_large_image", title: "Uppsolut Rent Manager", description: DESCRIPTION },
  robots: { index: true, follow: true },
}

const CONTENT: ProductPageContent = {
  headlineHeavy: "Every unit.",
  headlineLight: "Every month, on time.",
  intro:
    "Buildings, units and leases in one structure, and the monthly invoice run handled rather than rebuilt in a spreadsheet. Uppsolut Rent Manager is the long-stay counterpart to Stay.",
  problem: {
    title: "The portfolio lives in a spreadsheet nobody wants to inherit.",
    body:
      "Rental portfolios tend to be run from a workbook that only one person fully understands: units in one tab, tenants in another, and an invoice run that is a morning of copy-paste at the start of every month. It works until that person is on leave, a lease escalates, or someone asks what occupancy actually was last quarter. Rent Manager puts the structure in the system so the monthly run is a scheduled job rather than a ritual.",
  },
  capabilities: [
    {
      n: "01",
      title: "Buildings and units, in a real hierarchy",
      body: "A portfolio is a tree, not a flat list — property, block, floor, unit. Reporting rolls up it without anyone maintaining a second sheet.",
    },
    {
      n: "02",
      title: "Leases with dates that mean something",
      body: "Start, end, notice and escalation are held on the lease, so a renewal or a rent review is something the system raises rather than something someone remembers.",
    },
    {
      n: "03",
      title: "Monthly invoicing on a schedule",
      body: "The run generates from active leases on the day it is due — pro-rated where a lease starts mid-month — and produces the same branded documents Stay already renders.",
    },
    {
      n: "04",
      title: "Arrears you can actually see",
      body: "Who is late, by how much and for how long, carried on the same ledger model Stay uses for debtors rather than a colour someone applies by hand.",
    },
    {
      n: "05",
      title: "Occupancy across the portfolio",
      body: "Occupied, vacant, notice-given and under-maintenance as a live figure per building and for the whole portfolio.",
    },
    {
      n: "06",
      title: "Maintenance against the unit",
      body: "A job is raised on the unit and stays on its record, so a recurring fault is visible at renewal instead of being discovered twice.",
    },
  ],
  marquee: [
    "Buildings", "Units", "Leases", "Tenants", "Invoicing", "Arrears",
    "Occupancy", "Escalations", "Renewals", "Deposits", "Maintenance", "Statements",
  ],
}

export default function RentManagerPage() {
  return <ProductPage product={product} content={CONTENT} />
}
