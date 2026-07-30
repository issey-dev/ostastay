import type { StationeryBrand } from "@/lib/stationery-brand"
import type {
  InvoiceDocumentProps,
  InvoiceVariant,
  ReceiptDocumentProps,
  ConfirmationLetterDocumentProps,
  RegistrationCardDocumentProps,
  StatementDocumentProps,
} from "./documents"

// Sample-data builders for the configurator's live preview. They merge the operator's
// editable content (footers, terms, messages) with fixed placeholder booking data taken
// from the owner's PDF template, so the preview shows realistic output that updates as the
// content fields change. Real printed documents build the same prop shapes from live data
// (see the print pages) — these are only for the editor preview.

// The configurable content the Stationaries manager owns (everything that is NOT branding —
// branding comes from the property). Field names mirror EnterpriseSettings columns.
export type StationeryContent = {
  invoiceHeaderText: string
  invoicePaymentAccountName: string
  invoicePaymentAccountNumber: string
  invoicePaymentIban: string
  invoicePaymentBankInfo: string
  invoicePaymentTerms: string
  invoiceFooterText: string
  receiptFooterText: string
  receiptTerms: string
  statementFooterText: string
  statementTerms: string
  confirmationLetterMessage: string
  registrationCardMessage: string
  registrationCardTerms: string
}

export const EMPTY_STATIONERY_CONTENT: StationeryContent = {
  invoiceHeaderText: "",
  invoicePaymentAccountName: "",
  invoicePaymentAccountNumber: "",
  invoicePaymentIban: "",
  invoicePaymentBankInfo: "",
  invoicePaymentTerms: "",
  invoiceFooterText: "",
  receiptFooterText: "",
  receiptTerms: "",
  statementFooterText: "",
  statementTerms: "",
  confirmationLetterMessage: "",
  registrationCardMessage: "",
  registrationCardTerms: "",
}

const CURRENCY = "USD"

const DEFAULT_LETTER_POLICY =
  "We kindly request that all guests carry a valid photo ID or passport upon arrival. This letter may be presented as confirmation of accommodation for immigration and travel purposes. Should your travel plans change, please notify us as early as possible so we can assist accordingly."

const DEFAULT_REGCARD_TERMS =
  "I have read, understood and agree to abide by the hotel's terms & conditions. The room tariff is per night and exclusive of taxes unless stated otherwise. Bills must be settled on presentation. The hotel is not responsible for valuables not deposited at the front office. Guests are responsible for any loss or damage to hotel property. Check-out time and hotel policies apply as advised at the front desk."

function defaultInvoiceFooter(brand: StationeryBrand) {
  return `Payment due within 30 days of invoice date. Thank you for staying with ${brand.name}.`
}

export function buildSampleInvoice(
  brand: StationeryBrand,
  content: StationeryContent,
  variant: InvoiceVariant
): InvoiceDocumentProps {
  return {
    brand,
    variant,
    meta: [
      { label: variant === "tax" ? "Invoice No" : variant === "interim" ? "Statement" : "Proforma No", value: variant === "tax" ? "INV-00002" : "PRO-00002" },
      { label: "Confirmation", value: "VBH-000002" },
      { label: "Date", value: "27 Jul 2026" },
      { label: "Folio", value: "1" },
    ],
    headerText: content.invoiceHeaderText || null,
    billedTo: { name: "Lucas Muller", lines: ["lucas.muller@example.com"] },
    staySummary: [
      { label: "Check-in", value: "23 Jul 2026" },
      { label: "Check-out", value: "25 Jul 2026" },
      { label: "Nights", value: "2" },
      { label: "Rooms", value: "TBA" },
    ],
    charges: [
      { date: "23 Jul", description: "Accommodation — Deluxe Beach Villa (2 nights)", reference: "1000", amount: 359.0 },
      { date: "23 Jul", description: "Dinner", reference: "2003", amount: 140.0 },
      { date: "23 Jul", description: "Breakfast", reference: "2001", amount: 48.0 },
      { date: "23 Jul", description: "Green Tax", reference: "8500", amount: 48.0 },
      { date: "24 Jul", description: "Transport — Pickup (SPD-PVT)", reference: "5002", amount: 50.0 },
    ],
    payments: [],
    totals: [
      { label: "Subtotal Charges", amount: 463.88 },
      { label: "Service Charge (10%)", amount: 46.38 },
      { label: "TGST (17%)", amount: 86.74 },
      { label: "Green Tax", amount: 48.0 },
      { label: "Total Paid", amount: 0.0, emphasis: true },
    ],
    balanceLabel: "Net Balance Due",
    balanceAmount: 645.0,
    currency: CURRENCY,
    paymentInfo: {
      accountName: content.invoicePaymentAccountName || null,
      accountNumber: content.invoicePaymentAccountNumber || null,
      iban: content.invoicePaymentIban || null,
      bankInfo: content.invoicePaymentBankInfo || null,
    },
    terms: content.invoicePaymentTerms || null,
    footerNote: content.invoiceFooterText || defaultInvoiceFooter(brand),
  }
}

export function buildSampleReceipt(brand: StationeryBrand, content: StationeryContent): ReceiptDocumentProps {
  return {
    brand,
    kind: "payment",
    meta: [
      { label: "Receipt No", value: "RCT-00002" },
      { label: "Date", value: "27 Jul 2026" },
      { label: "Folio", value: "1" },
    ],
    receivedFrom: "Aishath Shazba",
    paymentDetails: [
      { label: "Method", value: "Credit Card" },
      { label: "Reference", value: "Initial Deposit" },
    ],
    rows: [{ date: "27 Jul 2026", description: "Payment — Credit Card", reference: "Initial Deposit", amount: 500.0 }],
    amountLabel: "Amount Received",
    amount: 500.0,
    currency: CURRENCY,
    remainingLabel: "Remaining folio balance",
    remainingAmount: 38.0,
    terms: content.receiptTerms || null,
    footerNote: content.receiptFooterText || `Thank you for staying with ${brand.name}.`,
  }
}

export function buildSampleLetter(brand: StationeryBrand, content: StationeryContent): ConfirmationLetterDocumentProps {
  const contactBits = [brand.phone, brand.email].filter(Boolean).join(" · ")
  const addressBits = [brand.name, brand.address].filter(Boolean).join(", ")
  return {
    brand,
    guestName: "Aishath Shazba",
    date: "27 July 2026",
    details: [
      { label: "Confirmation No.", value: "VBH-000003" },
      { label: "Guest Name(s)", value: "Aishath Shazba, Ehaab Shareef" },
      { label: "Stay Period", value: "22 Jul 2026 – 24 Jul 2026" },
      { label: "Nights", value: "2" },
      { label: "Room Category", value: "Deluxe Beach Villa" },
      { label: "Check-in", value: "From 14:00" },
      { label: "Check-out", value: "Until 12:00" },
    ],
    policyText: content.confirmationLetterMessage || DEFAULT_LETTER_POLICY,
    closingTeam: `${brand.name} Reservations Team`,
    footerContactLine: [contactBits, addressBits].filter(Boolean).join("   "),
  }
}

export function buildSampleRegistrationCard(
  brand: StationeryBrand,
  content: StationeryContent
): RegistrationCardDocumentProps {
  return {
    brand,
    meta: [
      { label: "Confirmation", value: "VBH-000003" },
      { label: "Date", value: "27 Jul 2026" },
    ],
    welcomeMessage: content.registrationCardMessage || "Welcome — please review, complete, and sign below.",
    guestDetails: [
      { label: "Name", value: "Aishath Shazba" },
      { label: "Company", value: "" },
      { label: "Travel agent", value: "Blue Horizon Tours" },
      { label: "Address", value: "" },
      { label: "City", value: "" },
      { label: "Postal code", value: "" },
      { label: "Country", value: "MV" },
      { label: "Telephone", value: "" },
      { label: "Email", value: "" },
      { label: "Date of birth", value: "08 Jan 1999" },
      { label: "Nationality", value: "MV" },
    ],
    stayDetails: [
      { label: "Room", value: "107" },
      { label: "Room type", value: "Deluxe Beach Villa" },
      { label: "Rate plan", value: "Best Available Rate" },
      { label: "Arrival", value: "22 Jul 2026" },
      { label: "Departure", value: "24 Jul 2026" },
      { label: "Nights", value: "2" },
      { label: "Adults / Children", value: "2 / 0" },
    ],
    identification: [
      { label: "ID type", value: "National ID" },
      { label: "ID number", value: "A1234567" },
      { label: "Issuing country", value: "MV" },
      { label: "Expiry date", value: "31 Jan 2031" },
    ],
    terms: content.registrationCardTerms || DEFAULT_REGCARD_TERMS,
  }
}

export function buildSampleStatement(brand: StationeryBrand, content: StationeryContent): StatementDocumentProps {
  return {
    brand,
    meta: [
      { label: "Account", value: "Blue Horizon Tours" },
      { label: "Period", value: "01 Jul – 27 Jul 2026" },
    ],
    account: { name: "Blue Horizon Tours", lines: ["accounts@bluehorizon.example", "City Ledger — Net 30"] },
    aging: [
      { label: "Current", value: "0.00" },
      { label: "1–30d", value: "645.00" },
      { label: "31–60d", value: "0.00" },
      { label: "61–90d", value: "0.00" },
      { label: "90+d", value: "0.00" },
    ],
    rows: [
      { date: "11 Jul 2026", description: "Aishath Shazba — INV-00001 (Paid)", reference: "VBH-000003", amount: 379.5 },
      { date: "18 Jul 2026", description: "Lucas Muller — INV-00002", reference: "VBH-000002", amount: 645.0 },
    ],
    totals: [
      { label: "Invoiced", amount: 1024.5 },
      { label: "Paid", amount: 379.5, emphasis: true },
    ],
    balanceLabel: "Balance Due",
    balanceAmount: 645.0,
    currency: CURRENCY,
    terms: content.statementTerms || null,
    footerNote: content.statementFooterText || `Thank you for your business with ${brand.name}.`,
  }
}
