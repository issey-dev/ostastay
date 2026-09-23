import { prisma } from "@/lib/db";
import { dayRange, rangeBounds } from "@/lib/reports/params";
import { guestName, propertyOrThrow, guestSelect } from "@/lib/reports/defs/_shared";
import { summarizeShiftPayments, expectedCashForShift } from "@/lib/shift-summary";
import type { ReportDef, ReportResult, ReportGroup } from "@/lib/reports/types";
import { LINE_BUCKET_INCLUDE, lineReportBucket, reportBucketLabel, isLevyLine } from "@/lib/posting/report-bucket";
import { countryNameFor } from "@/lib/countries";
import { bookingMethodFor, greenTaxCategory, isBookingMethod, isStayBasis, localTime, meetsMinStay, sheetGuestName } from "@/lib/green-tax-sheet";
import { renderGreenTaxXlsx } from "@/lib/reports/render/green-tax-xlsx";

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

// ─── Green Tax Report (MIRA Green Tax information sheet) ─────────────────────
// One row per GuestRegistration in MIRA's GRTInfoSheet25.1 layout — the columns, order
// and codes of the government submission. The Excel export writes the exact sheet (see
// render/green-tax-xlsx.ts); category and booking-method rules live in green-tax-sheet.ts.
const greenTax: ReportDef = {
  key: "fin-green-tax",
  module: "FINANCIAL",
  name: "Green Tax Report",
  description: "MIRA Green Tax information sheet — every registered guest who stayed in the period, by registration number.",
  params: [{ key: "range", label: "Stayed between", type: "dateRange", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const [property, settings] = await Promise.all([
      prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { timeZone: true, checkInTime: true, checkOutTime: true } }),
      prisma.enterpriseSettings.findUnique({ where: { enterpriseId: rc.ctx.enterpriseId }, select: { greenTaxExemptAge: true } }),
    ]);
    const infantAge = settings?.greenTaxExemptAge ?? 2;

    const regs = await prisma.guestRegistration.findMany({
      // Filed monthly by STAY date: everyone in house for at least one night of the period
      // (arrived before it ends, departs after it starts), so a stay-over carried in from
      // the previous month appears with its earlier number — the month's list skips
      // numbers while the year's sequence itself has none. An early check-out moves
      // checkOutDate to the actual day, so the booking's dates are the real stay.
      where: { propertyId, reservation: { checkInDate: { lt }, checkOutDate: { gt: gte } } },
      include: {
        profile: {
          select: {
            firstName: true, middleName: true, lastName: true, dateOfBirth: true, nationality: true,
            documents: { select: { documentNumber: true, isWorkPermit: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
          },
        },
        reservation: {
          select: {
            status: true, checkInDate: true, checkOutDate: true, checkedInAt: true, checkedOutAt: true,
            travelAgent: { select: { bookingMethod: true } },
          },
        },
      },
      orderBy: [{ year: "asc" }, { registrationNo: "asc" }],
    });

    const missing = { id: 0, dob: 0, nationality: 0, bookingMethod: 0 };
    const rows = regs.map((r) => {
      const { profile: p, reservation: res } = r;
      const idNo = p.documents[0]?.documentNumber ?? "";
      const bookingMethod = bookingMethodFor(res.travelAgent);
      if (!idNo) missing.id++;
      if (!p.dateOfBirth) missing.dob++;
      if (!p.nationality) missing.nationality++;
      if (!bookingMethod) missing.bookingMethod++;
      // An actual check-out carries its own date and time; otherwise the booked
      // departure at the property's standard check-out time.
      const out = res.status === "CHECKED_OUT" && res.checkedOutAt ? res.checkedOutAt : null;
      return {
        regNo: r.registrationNo,
        guest: sheetGuestName(p),
        category: greenTaxCategory({
          dateOfBirth: p.dateOfBirth,
          nationality: p.nationality,
          isWorkPermitHolder: p.documents.some((d) => d.isWorkPermit),
          checkInDate: res.checkInDate,
          infantAge,
        }),
        dob: p.dateOfBirth,
        idNo,
        nationality: (countryNameFor(p.nationality) ?? "").toUpperCase(),
        bookingMethod: bookingMethod ?? "",
        checkInDate: res.checkInDate,
        checkInTime: res.checkedInAt ? localTime(res.checkedInAt, property.timeZone) : property.checkInTime,
        // en-CA renders YYYY-MM-DD, which Date parses as that UTC midnight.
        checkOutDate: out ? new Date(out.toLocaleDateString("en-CA", { timeZone: property.timeZone })) : res.checkOutDate,
        checkOutTime: out ? localTime(out, property.timeZone) : property.checkOutTime,
      };
    });

    const gaps = [
      missing.bookingMethod && `${missing.bookingMethod} without a booking method (set it on the agent profile)`,
      missing.id && `${missing.id} without an identification no.`,
      missing.dob && `${missing.dob} without a date of birth`,
      missing.nationality && `${missing.nationality} without a nationality`,
    ].filter(Boolean);
    return {
      title: "Green Tax Report",
      subtitle: `Stayed ${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))} — ${rows.length} guest(s)`,
      note:
        "Category: 1 Normal · 2 Maldivian · 3 Work permit holder · 4 Infant (under " + infantAge + ")." +
        (gaps.length ? ` Incomplete for MIRA: ${gaps.join("; ")}.` : ""),
      columns: [
        { key: "regNo", label: "Guest Registration No.", width: 0.8, format: "number" },
        { key: "guest", label: "Name of Guest", width: 1.8 },
        { key: "category", label: "Category", width: 0.6, format: "number", align: "center" },
        { key: "dob", label: "Date of birth", width: 0.9, format: "date" },
        { key: "idNo", label: "Identification No.", width: 1 },
        { key: "nationality", label: "Nationality", width: 1 },
        { key: "bookingMethod", label: "Booking Method", width: 1.1 },
        { key: "checkInDate", label: "Check-in Date", width: 0.9, format: "date" },
        { key: "checkInTime", label: "Check-in Time", width: 0.6 },
        { key: "checkOutDate", label: "Check-out Date", width: 0.9, format: "date" },
        { key: "checkOutTime", label: "Check-out Time", width: 0.6 },
      ],
      rows,
    };
  },
  renderXlsx: renderGreenTaxXlsx,
};

// ─── Missing Profile Information (Green Tax sheet readiness) ─────────────────
// Everything that would make the MIRA Green Tax sheet for the period incomplete, by
// severity: HIGH — a guest who should carry a Reg No has none, or a number of the year is
// skipped; MEDIUM — no identification no., date of birth or nationality; LOW — the booking
// has a Travel Agent/Company account whose Booking Method isn't set. Same "stayed between"
// selection as the Green Tax Report. Guests the sheet leaves out by rule (PM room, stay
// under 12 hours) are not checked. Identification is the primary document, else the
// earliest added — the same one the sheet prints.
const greenTaxMissing: ReportDef = {
  key: "fin-green-tax-missing",
  module: "FINANCIAL",
  name: "Missing Profile Information",
  description: "Guests whose Green Tax sheet data is incomplete — missing or skipped Reg No, ID, date of birth, nationality, booking method.",
  params: [{ key: "range", label: "Stayed between", type: "dateRange", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const [property, settings] = await Promise.all([
      prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { timeZone: true, checkInTime: true, checkOutTime: true } }),
      prisma.enterpriseSettings.findUnique({ where: { enterpriseId: rc.ctx.enterpriseId }, select: { greenTaxStayBasis: true } }),
    ]);
    const basis = isStayBasis(settings?.greenTaxStayBasis) ? settings.greenTaxStayBasis : "ACTUAL";

    const reservations = await prisma.reservation.findMany({
      where: { propertyId, status: { in: ["IN_HOUSE", "CHECKED_OUT"] }, checkInDate: { lt }, checkOutDate: { gt: gte } },
      select: {
        confirmationNo: true, status: true, checkInDate: true, checkOutDate: true, checkedInAt: true, checkedOutAt: true,
        primaryGuestId: true,
        travelAgent: { select: { firstName: true, lastName: true, companyName: true, profileType: true, bookingMethod: true } },
        assignments: { select: { roomType: { select: { name: true, isPseudo: true } } } },
        accompanyingGuests: { select: { profileId: true }, orderBy: { createdAt: "asc" } },
        guestRegistrations: { select: { profileId: true, registrationNo: true, year: true } },
      },
      orderBy: [{ checkInDate: "asc" }, { checkedInAt: "asc" }],
    });
    const profileIds = [...new Set(reservations.flatMap((r) => [r.primaryGuestId, ...r.accompanyingGuests.map((a) => a.profileId)]))];
    const profiles = new Map(
      (await prisma.profile.findMany({
        where: { upid: { in: profileIds } },
        select: {
          upid: true, firstName: true, middleName: true, lastName: true, dateOfBirth: true, nationality: true,
          documents: { select: { documentNumber: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 },
        },
      })).map((p) => [p.upid, p])
    );

    type Row = Record<string, unknown> & { regNo: number | null };
    const high: Row[] = [], medium: Row[] = [], low: Row[] = [];

    for (const res of reservations) {
      const roomTypes = [...new Set(res.assignments.filter((a) => !a.roomType.isPseudo).map((a) => a.roomType.name))];
      // Left off the sheet by rule — nothing to complete.
      if (!roomTypes.length || !meetsMinStay(res, property, basis)) continue;
      const ta = res.travelAgent;
      const guestIds = [...new Set([res.primaryGuestId, ...res.accompanyingGuests.map((a) => a.profileId)])];
      for (const upid of guestIds) {
        const p = profiles.get(upid);
        if (!p) continue;
        const reg = res.guestRegistrations.find((g) => g.profileId === upid);
        const base = {
          regNo: reg?.registrationNo ?? null,
          guest: sheetGuestName(p),
          conf: res.confirmationNo,
          roomType: roomTypes.join(", "),
          travelAgent: ta ? guestName(ta) : "",
          idNo: p.documents[0]?.documentNumber ?? "",
          dob: p.dateOfBirth,
          nationality: (countryNameFor(p.nationality) ?? "").toUpperCase(),
          bookingMethod: bookingMethodFor(ta) ?? "",
          checkInDate: res.checkInDate,
          checkOutDate: res.checkOutDate,
        };
        if (!reg) high.push({ ...base, issue: "No Reg No assigned" });
        const gaps = [!base.idNo && "Identification No.", !p.dateOfBirth && "Date of birth", !p.nationality && "Nationality"].filter(Boolean);
        if (gaps.length) medium.push({ ...base, issue: `Missing ${gaps.join(", ")}` });
        if (ta && !isBookingMethod(ta.bookingMethod)) low.push({ ...base, issue: `Booking Method not set on ${base.travelAgent}` });
      }
    }

    // Skipped numbers: every number below the highest one the period's sheet prints (the
    // Green Tax Report's own selection) must exist in its year.
    const periodMax = await prisma.guestRegistration.groupBy({
      by: ["year"],
      where: { propertyId, reservation: { checkInDate: { lt }, checkOutDate: { gt: gte } } },
      _max: { registrationNo: true },
    });
    for (const { year, _max } of periodMax) {
      const maxNo = _max.registrationNo ?? 0;
      const taken = new Set(
        (await prisma.guestRegistration.findMany({ where: { propertyId, year, registrationNo: { lte: maxNo } }, select: { registrationNo: true } }))
          .map((r) => r.registrationNo)
      );
      for (let n = 1; n < maxNo; n++) {
        if (!taken.has(n)) high.push({ regNo: n, guest: "—", issue: `Reg No ${n} (${year}) skipped — no guest holds it` });
      }
    }

    const byRegNo = (a: Row, b: Row) => (a.regNo ?? Infinity) - (b.regNo ?? Infinity);
    const groups = [
      { label: `High — Reg No missing or skipped (${high.length})`, rows: high.sort(byRegNo) },
      { label: `Medium — ID, date of birth or nationality missing (${medium.length})`, rows: medium.sort(byRegNo) },
      { label: `Low — Booking Method not set on the account (${low.length})`, rows: low.sort(byRegNo) },
    ].filter((g) => g.rows.length);
    const total = high.length + medium.length + low.length;
    return {
      title: "Missing Profile Information",
      subtitle: `Stayed ${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))} — ${total ? `${total} issue(s)` : "nothing missing"}`,
      note: "Checks everything the MIRA Green Tax sheet needs. Guests left off the sheet by rule (PM room, stay under 12 hours) are not listed. Identification is the guest's primary document.",
      columns: [
        { key: "regNo", label: "Reg No", width: 0.6, format: "number" },
        { key: "guest", label: "Name of Guest", width: 1.5 },
        { key: "issue", label: "Issue", width: 1.8 },
        { key: "conf", label: "Confirmation", width: 0.9 },
        { key: "roomType", label: "Room Type", width: 0.9 },
        { key: "travelAgent", label: "Travel Agent", width: 1.1 },
        { key: "idNo", label: "Identification No.", width: 1 },
        { key: "dob", label: "Date of birth", width: 0.9, format: "date" },
        { key: "nationality", label: "Nationality", width: 1 },
        { key: "bookingMethod", label: "Booking Method", width: 1 },
        { key: "checkInDate", label: "Check-in", width: 0.9, format: "date" },
        { key: "checkOutDate", label: "Check-out", width: 0.9, format: "date" },
      ],
      groups,
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

export const FINANCIAL_REPORTS: ReportDef[] = [journal, cashierSummary, outletSales, folioTax, greenTax, greenTaxMissing, gst];
