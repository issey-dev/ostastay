import { prisma } from "@/lib/db";
import { dayRange, rangeBounds } from "@/lib/reports/params";
import { guestName, propertyOrThrow, guestSelect } from "@/lib/reports/defs/_shared";
import { summarizeShiftPayments, expectedCashForShift } from "@/lib/shift-summary";
import type { ReportDef, ReportResult, ReportGroup } from "@/lib/reports/types";
import { LINE_BUCKET_INCLUDE, lineReportBucket, reportBucketLabel, isLevyLine } from "@/lib/posting/report-bucket";
import { countryNameFor } from "@/lib/countries";

const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ─── Transaction Journal ────────────────────────────────────────────────────
const journal: ReportDef = {
  key: "fin-transaction-journal",
  module: "FINANCIAL",
  name: "Transaction Journal",
  description: "Every charge and payment posted on the selected business date.",
  params: [{ key: "date", label: "Business date", type: "date", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const date = rc.params.date as Date;
    const { gte, lt } = dayRange(date);

    const charges = await prisma.folioLineItem.findMany({
      where: { folio: { propertyId }, date: { gte, lt } },
      include: { chargeCode: { select: { code: true } }, folio: { select: { folioNumber: true, reservation: { select: { confirmationNo: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    const payments = await prisma.payment.findMany({
      where: { folio: { propertyId }, shift: { businessDate: gte } },
      include: { paymentMethod: { select: { name: true } }, folio: { select: { folioNumber: true, reservation: { select: { confirmationNo: true } } } } },
      orderBy: { createdAt: "asc" },
    });

    const rows = [
      ...charges.map((c) => ({
        _t: c.createdAt.getTime(),
        kind: c.isVoid ? "Void" : "Charge",
        ref: c.folio.reservation?.confirmationNo ?? `Folio ${c.folio.folioNumber}`,
        detail: c.description,
        code: c.chargeCode?.code ?? "",
        amount: c.isVoid ? 0 : c.amount + c.taxAmount + (c.serviceChargeAmount || 0),
      })),
      ...payments.map((p) => ({
        _t: p.createdAt.getTime(),
        kind: p.isRefund ? "Refund" : "Payment",
        ref: p.folio.reservation?.confirmationNo ?? `Folio ${p.folio.folioNumber}`,
        detail: p.paymentMethod.name,
        code: "",
        amount: -(p.isRefund ? -p.amount : p.amount),
      })),
    ].sort((a, b) => a._t - b._t);

    const chargeTotal = charges.reduce((s, c) => (c.isVoid ? s : s + c.amount + c.taxAmount + (c.serviceChargeAmount || 0)), 0);
    const payTotal = payments.reduce((s, p) => s + (p.isRefund ? -p.amount : p.amount), 0);
    return {
      title: "Transaction Journal",
      subtitle: `${fmtDay(gte)} — ${charges.length} charge(s), ${payments.length} payment(s)`,
      columns: [
        { key: "kind", label: "Type", width: 0.8 },
        { key: "ref", label: "Reference", width: 1.2 },
        { key: "detail", label: "Detail", width: 2 },
        { key: "code", label: "Code", width: 0.8 },
        { key: "amount", label: "Amount", width: 1, format: "currency" },
      ],
      rows: rows.map(({ _t, ...r }) => r),
      totals: { detail: `Charges ${round2(chargeTotal)} · Payments ${round2(payTotal)}`, amount: round2(chargeTotal - payTotal) },
    };
  },
};

// ─── Cashier Summary ────────────────────────────────────────────────────────
const cashierSummary: ReportDef = {
  key: "fin-cashier-summary",
  module: "FINANCIAL",
  name: "Cashier Summary",
  description: "Collections by cashier and payment method for the selected business date.",
  params: [{ key: "date", label: "Business date", type: "date", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const date = rc.params.date as Date;
    const { gte } = dayRange(date);
    const shifts = await prisma.cashierShift.findMany({
      where: { propertyId, businessDate: gte },
      include: { payments: { include: { paymentMethod: { select: { name: true, type: true } } } }, paidOuts: true, currencyExchanges: true, property: { select: { defaultCurrency: true } } },
    });
    const userIds = Array.from(new Set(shifts.map((s) => s.userId)));
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } });
    const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName ?? ""}`.trim()]));

    const groups: ReportGroup[] = [];
    let grandNet = 0;
    for (const s of shifts) {
      const { byMethod } = summarizeShiftPayments(s.payments);
      const expected = expectedCashForShift(s.openingFloat, s.payments, s.paidOuts, s.currencyExchanges, s.property?.defaultCurrency ?? null);
      const net = byMethod.reduce((x, m) => x + m.net, 0);
      grandNet += net;
      groups.push({
        label: `${userName.get(s.userId) ?? "Cashier"} — expected cash ${round2(expected)}`,
        rows: byMethod.map((m) => ({ method: m.method, received: round2(m.received), refunded: round2(m.refunded), net: round2(m.net) })),
        subtotals: { received: round2(byMethod.reduce((x, m) => x + m.received, 0)), refunded: round2(byMethod.reduce((x, m) => x + m.refunded, 0)), net: round2(net) },
      });
    }
    return {
      title: "Cashier Summary",
      subtitle: `${fmtDay(gte)} — ${shifts.length} shift(s)`,
      columns: [
        { key: "method", label: "Method", width: 1.6 },
        { key: "received", label: "Received", width: 1, format: "currency" },
        { key: "refunded", label: "Refunded", width: 1, format: "currency" },
        { key: "net", label: "Net", width: 1, format: "currency" },
      ],
      groups,
      totals: { method: "All cashiers", net: round2(grandNet) },
    };
  },
};

// ─── Outlet Sales ───────────────────────────────────────────────────────────
const outletSales: ReportDef = {
  key: "fin-outlet-sales",
  module: "FINANCIAL",
  name: "Outlet Sales",
  description: "Revenue posted through each outlet over the selected date range.",
  params: [
    { key: "range", label: "Date range", type: "dateRange", required: true, defaultToday: true },
    { key: "outletIds", label: "Outlets", type: "multiSelect", optionSource: "outlets" },
  ],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const outletIds = (rc.params.outletIds as string[]) ?? [];
    const lines = await prisma.folioLineItem.findMany({
      where: { folio: { propertyId }, outletId: outletIds.length ? { in: outletIds } : { not: null }, isVoid: false, date: { gte, lt } },
      include: { outlet: { select: { name: true } } },
    });
    const byOutlet = new Map<string, { outlet: string; count: number; net: number; tax: number; serviceCharge: number; total: number }>();
    for (const li of lines) {
      const key = li.outlet?.name ?? "—";
      const row = byOutlet.get(key) ?? { outlet: key, count: 0, net: 0, tax: 0, serviceCharge: 0, total: 0 };
      row.count += 1;
      row.net += li.amount;
      row.tax += li.taxAmount;
      row.serviceCharge += li.serviceChargeAmount || 0;
      row.total += li.amount + li.taxAmount + (li.serviceChargeAmount || 0);
      byOutlet.set(key, row);
    }
    const rows = Array.from(byOutlet.values())
      .map((r) => ({ ...r, net: round2(r.net), tax: round2(r.tax), serviceCharge: round2(r.serviceCharge), total: round2(r.total) }))
      .sort((a, b) => b.total - a.total);
    return {
      title: "Outlet Sales",
      subtitle: `${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))}`,
      columns: [
        { key: "outlet", label: "Outlet", width: 1.6 },
        { key: "count", label: "Postings", width: 0.8, format: "number" },
        { key: "net", label: "Net", width: 1, format: "currency" },
        { key: "serviceCharge", label: "Service Chg", width: 1, format: "currency" },
        { key: "tax", label: "GST", width: 0.9, format: "currency" },
        { key: "total", label: "Total", width: 1, format: "currency" },
      ],
      rows,
      totals: {
        net: round2(rows.reduce((s, r) => s + r.net, 0)),
        serviceCharge: round2(rows.reduce((s, r) => s + r.serviceCharge, 0)),
        tax: round2(rows.reduce((s, r) => s + r.tax, 0)),
        total: round2(rows.reduce((s, r) => s + r.total, 0)),
      },
    };
  },
};

// ─── Folio Tax (all taxes) ──────────────────────────────────────────────────
// Service charge and GST are stored separately (serviceChargeAmount / taxAmount);
// Green Tax is its own GTX-coded line. This report sums each bucket over the range.
const folioTax: ReportDef = {
  key: "fin-folio-tax",
  module: "FINANCIAL",
  name: "Folio Tax",
  description: "Service charge, GST and Green Tax posted, grouped by charge category.",
  params: [{ key: "range", label: "Date range", type: "dateRange", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const lines = await prisma.folioLineItem.findMany({
      where: { folio: { propertyId }, isVoid: false, date: { gte, lt } },
      include: LINE_BUCKET_INCLUDE,
    });
    const byCat = new Map<string, { category: string; base: number; serviceCharge: number; gst: number; greenTax: number }>();
    for (const li of lines) {
      // A levy (postingType TAX) is reported in its own bucket and never contributes to
      // the GST base — that used to be a hardcoded `code === "GTX"` test. Service Charge
      // and GST lines, by contrast, report under the revenue that earned them
      // (lineReportBucket), so a per-group tax code doesn't detach tax from its source.
      const isGtx = isLevyLine(li.chargeCode);
      const cat = isGtx ? "GREEN_TAX" : lineReportBucket(li);
      const row = byCat.get(cat) ?? { category: isGtx ? "Green Tax" : reportBucketLabel(cat), base: 0, serviceCharge: 0, gst: 0, greenTax: 0 };
      if (isGtx) row.greenTax += li.amount;
      else { row.base += li.amount; row.serviceCharge += li.serviceChargeAmount || 0; row.gst += li.taxAmount; }
      byCat.set(cat, row);
    }
    const rows = Array.from(byCat.values())
      .map((r) => ({ ...r, base: round2(r.base), serviceCharge: round2(r.serviceCharge), gst: round2(r.gst), greenTax: round2(r.greenTax), totalTax: round2(r.serviceCharge + r.gst + r.greenTax) }))
      .sort((a, b) => b.totalTax - a.totalTax);
    return {
      title: "Folio Tax",
      subtitle: `${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))}`,
      columns: [
        { key: "category", label: "Category", width: 1.4 },
        { key: "base", label: "Net", width: 1, format: "currency" },
        { key: "serviceCharge", label: "Service Chg", width: 1, format: "currency" },
        { key: "gst", label: "GST", width: 0.9, format: "currency" },
        { key: "greenTax", label: "Green Tax", width: 1, format: "currency" },
        { key: "totalTax", label: "Total Tax", width: 1, format: "currency" },
      ],
      rows,
      totals: {
        base: round2(rows.reduce((s, r) => s + r.base, 0)),
        serviceCharge: round2(rows.reduce((s, r) => s + r.serviceCharge, 0)),
        gst: round2(rows.reduce((s, r) => s + r.gst, 0)),
        greenTax: round2(rows.reduce((s, r) => s + r.greenTax, 0)),
        totalTax: round2(rows.reduce((s, r) => s + r.totalTax, 0)),
      },
    };
  },
};

// ─── Green Tax Report (by guest registration no) ────────────────────────────
const greenTax: ReportDef = {
  key: "fin-green-tax",
  module: "FINANCIAL",
  name: "Green Tax Report",
  description: "Green Tax by guest registration number — the government submission list.",
  params: [{ key: "range", label: "Registered between", type: "dateRange", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: rc.ctx.enterpriseId }, select: { greenTaxAdultAmount: true, greenTaxChildAmount: true } });
    const adultRate = settings?.greenTaxAdultAmount ?? 0;
    const childRate = settings?.greenTaxChildAmount ?? 0;

    const regs = await prisma.guestRegistration.findMany({
      where: { propertyId, businessDate: { gte, lt } },
      include: {
        profile: { select: { firstName: true, lastName: true, companyName: true, profileType: true, nationality: true } },
        reservation: { select: { confirmationNo: true, checkInDate: true, checkOutDate: true, adults: true, children: true, assignments: { select: { room: { select: { roomNumber: true } } } } } },
      },
      orderBy: [{ year: "asc" }, { registrationNo: "asc" }],
    });
    const rows = regs.map((r) => {
      const nights = Math.max(1, Math.round((r.reservation.checkOutDate.getTime() - r.reservation.checkInDate.getTime()) / 86_400_000));
      // Per-registration green tax: primary carries the room's adult/child levy across the stay.
      const perNight = r.isPrimary ? r.reservation.adults * adultRate + r.reservation.children * childRate : 0;
      return {
        regNo: r.registrationNo,
        guest: guestName(r.profile),
        nationality: countryNameFor(r.profile.nationality) ?? "—",
        room: r.reservation.assignments.map((a) => a.room?.roomNumber).filter(Boolean).join(", ") || "—",
        conf: r.reservation.confirmationNo,
        nights,
        greenTax: round2(perNight * nights),
      };
    });
    return {
      title: "Green Tax Report",
      subtitle: `Registrations ${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))} — ${rows.length} guest(s)`,
      note: "Green Tax is carried on the primary registration for each room (per-room adult/child levy × nights).",
      columns: [
        { key: "regNo", label: "Reg. No", width: 0.7, format: "number" },
        { key: "guest", label: "Guest", width: 1.6 },
        { key: "nationality", label: "Nationality", width: 1 },
        { key: "room", label: "Room", width: 0.7 },
        { key: "conf", label: "Confirmation", width: 1.1 },
        { key: "nights", label: "Nights", width: 0.6, format: "number" },
        { key: "greenTax", label: "Green Tax", width: 1, format: "currency" },
      ],
      rows,
      totals: { greenTax: round2(rows.reduce((s, r) => s + r.greenTax, 0)) },
    };
  },
};

// ─── GST Report (invoice amount + tax per invoice) ──────────────────────────
const gst: ReportDef = {
  key: "fin-gst",
  module: "FINANCIAL",
  name: "GST Report",
  description: "Tax invoices with net, service charge and GST — for the GST return.",
  params: [{ key: "range", label: "Invoiced between", type: "dateRange", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    // Folios that carry a tax invoice number, with charges posted in the window.
    const folios = await prisma.folio.findMany({
      where: { propertyId, taxInvoiceNumber: { not: null }, lineItems: { some: { date: { gte, lt } } } },
      include: {
        lineItems: { include: { chargeCode: { select: { code: true, postingType: true } } } },
        reservation: { select: { primaryGuest: guestSelect } },
      },
      orderBy: { taxInvoiceNumber: "asc" },
    });
    const rows = folios.map((f) => {
      let base = 0, sc = 0, gstAmt = 0;
      for (const li of f.lineItems) {
        if (li.isVoid || li.date < gte || li.date >= lt) continue;
        if (isLevyLine(li.chargeCode)) { base += li.amount; continue; } // a levy is not GST-bearing
        base += li.amount; sc += li.serviceChargeAmount || 0; gstAmt += li.taxAmount;
      }
      return {
        invoice: f.taxInvoiceNumber,
        guest: f.reservation ? guestName(f.reservation.primaryGuest) : (f.walkInGuestName ?? "—"),
        net: round2(base), serviceCharge: round2(sc), gst: round2(gstAmt), total: round2(base + sc + gstAmt),
      };
    });
    return {
      title: "GST Report",
      subtitle: `Invoices with activity ${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))} — ${rows.length} invoice(s)`,
      columns: [
        { key: "invoice", label: "Invoice No", width: 1 },
        { key: "guest", label: "Guest", width: 2 },
        { key: "net", label: "Net", width: 1, format: "currency" },
        { key: "serviceCharge", label: "Service Chg", width: 1, format: "currency" },
        { key: "gst", label: "GST", width: 1, format: "currency" },
        { key: "total", label: "Total", width: 1, format: "currency" },
      ],
      rows,
      totals: {
        net: round2(rows.reduce((s, r) => s + r.net, 0)),
        serviceCharge: round2(rows.reduce((s, r) => s + r.serviceCharge, 0)),
        gst: round2(rows.reduce((s, r) => s + r.gst, 0)),
        total: round2(rows.reduce((s, r) => s + r.total, 0)),
      },
    };
  },
};

export const FINANCIAL_REPORTS: ReportDef[] = [journal, cashierSummary, outletSales, folioTax, greenTax, gst];
