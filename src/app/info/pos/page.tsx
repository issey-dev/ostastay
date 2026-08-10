import type { Metadata } from "next"
import { productBySlug } from "../products"
import { ProductPage, type ProductPageContent } from "../product-page"

const product = productBySlug("pos")!

const DESCRIPTION =
  "Uppsolut POS is a retail point-of-sale system in development — thermal receipt printing, barcode scanning, multi-terminal stores and stock that moves the moment a sale closes."

export const metadata: Metadata = {
  title: "Uppsolut POS — retail point of sale",
  description: DESCRIPTION,
  keywords: [
    "POS software",
    "point of sale",
    "retail software",
    "barcode scanner POS",
    "thermal receipt printer",
    "inventory management",
    "Uppsolut POS",
  ],
  alternates: { canonical: "/info/pos" },
  openGraph: {
    type: "website",
    url: "/info/pos",
    title: "Uppsolut POS — retail point of sale",
    description: DESCRIPTION,
    siteName: "Uppsolut",
  },
  twitter: { card: "summary_large_image", title: "Uppsolut POS", description: DESCRIPTION },
  robots: { index: true, follow: true },
}

const CONTENT: ProductPageContent = {
  headlineHeavy: "Sell fast.",
  headlineLight: "Count everything.",
  intro:
    "A till that keeps up with a queue, and a stock figure that is still true at the end of the day. Uppsolut POS is the retail half of the engine that already runs properties.",
  problem: {
    title: "The count is wrong by closing time.",
    body:
      "Retail software usually fails in one of two directions: a till fast enough for the counter that tells the office nothing, or a stock system the counter routes around because it is too slow to use with someone waiting. Uppsolut POS is built so the sale and the stock movement are the same event — the count is a consequence of selling, not a second job someone does after close.",
  },
  capabilities: [
    {
      n: "01",
      title: "Hardware that is already on the counter",
      body: "Thermal receipt printers and wired or wireless barcode scanners, driven directly rather than through a browser print dialog that asks the cashier a question.",
    },
    {
      n: "02",
      title: "Checkout that does not wait",
      body: "Scan, total, take payment. The transaction commits and stock adjusts in the same step, so two terminals cannot both sell the last unit.",
    },
    {
      n: "03",
      title: "Several terminals, one catalogue",
      body: "Products, prices and tax are defined once for the store. A new till is configuration, not a fresh import.",
    },
    {
      n: "04",
      title: "Stock that reflects reality",
      body: "Receipts, returns, wastage and transfers all move the same figure, so a stocktake is a check rather than a reconstruction.",
    },
    {
      n: "05",
      title: "Shift and settlement discipline",
      body: "The cashiering model Stay already uses — open a shift, take payments across methods, close and settle against a counted drawer.",
    },
    {
      n: "06",
      title: "Posts to a room, when there is one",
      body: "For a property running both, an outlet sale can go to the guest folio instead of the drawer, which is the whole argument for one engine.",
    },
  ],
  marquee: [
    "Checkout", "Barcode", "Thermal Receipt", "Stock", "Catalogue", "Tax",
    "Shifts", "Settlement", "Returns", "Transfers", "Terminals", "Reports",
  ],
}

export default function PosPage() {
  return <ProductPage product={product} content={CONTENT} />
}
