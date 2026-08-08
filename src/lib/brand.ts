// The Uppsolut brand constants, as JavaScript values.
//
// WHY THIS FILE EXISTS. src/app/theme.css is the design system and stays the source of
// truth for anything the browser styles. But several surfaces in this app cannot read a
// CSS custom property and need a literal:
//
//   - HTML metadata      <meta name="theme-color">, the web app manifest
//   - PDF / XLSX output  pdf-lib and exceljs take numeric colours, not CSS
//   - Email HTML         inline styles in a mail client, no stylesheet, no vars
//
// Before this file those contexts each grew their own private hex (the stationery
// default was indigo #4f46e5, which belonged to no palette the product has ever used).
// One named module means a palette change has one obvious place to land.
//
// KEEP IN STEP WITH src/app/theme.css BY HAND. There is no build-time link between the
// two — that is the cost of needing the values in both worlds.
//
// Source: branding-guide/uppsolut_brand_guidelines.html §04 "Color System".

/** Primary brand colour. CTAs, active states, key icons, hero highlights. */
export const CRIMSON_OS = "#8B0000"

/** Structure: dark headers, sidebar nav, footers. */
export const DEEP_MAROON = "#580816"

/** Base dark: canvas, high-contrast text, primary type. */
export const OBSIDIAN_BLACK = "#0D0F11"

/** Surface neutral: cards, table borders, inactive UI. */
export const STEEL_SLATE = "#1A1D20"

/** Base light: dashboard background, app canvas, light text. */
export const COOL_PLATINUM = "#F4F6F8"

/**
 * Product names.
 *
 * `UPPSOLUT` is the company and the platform. `UPPSOLUT_STAY` is this application — the
 * Property module in the brand's sub-brand architecture (guide §06, alongside Stock,
 * Pay, Desk and Rent). Use the plain company name on anything that is legally or
 * commercially Uppsolut-the-vendor (license invoices, the platform-admin console) and
 * the Stay name on anything that is this product.
 */
export const BRAND_NAME = "Uppsolut"
export const PRODUCT_NAME = "Uppsolut Stay"
