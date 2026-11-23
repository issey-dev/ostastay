// LOCAL DEMO ONLY — simulates a booking channel sending bookings, so the channel flows can be
// tried at http://localhost:3000 without a real channel manager.
//
//   npm run channels:demo -- create                 a new OTA booking, converted into a reservation
//   npm run channels:demo -- cancel <ref>           the channel cancels it (auto-cancel or flag)
//   npm run channels:demo -- change <ref>           the channel moves it one day later and adds an adult (flag)
//   npm run channels:demo -- list                   the demo bookings and their state
//
// Optional: --property <code> (default VEYO-MAIN).
//
// Refuses to run against anything but a local database. Uses the real ingest / convert /
// reconcile code, so what you see is what a real webhook would do. The demo connection has
// sharing OFF and a dummy credential, so nothing is ever sent anywhere.
import { prisma } from "../../src/lib/db";
import { ingestBooking } from "../../src/lib/channels/inbound/ingest";
import { convertInboundBooking } from "../../src/lib/channels/inbound/convert";
import { beds24Provider } from "../../src/lib/channels/providers/beds24-provider";
import { resolveBusinessDate } from "../../src/lib/business-date";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("Refusing to run: DATABASE_URL is not a local database.");
  process.exit(1);
}

const args = process.argv.slice(2);
const cmd = args[0];
const ref = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
const propIdx = args.indexOf("--property");
const propertyCode = propIdx >= 0 ? args[propIdx + 1] : "VEYO-MAIN";

const property = await prisma.property.findFirst({
  where: { code: propertyCode },
  include: {
    enterprise: { select: { slug: true } },
    roomTypes: { where: { isActive: true, isPseudo: false }, orderBy: { name: "asc" } },
    ratePlans: { orderBy: { code: "asc" } },
  },
});
if (!property) {
  console.error(`No property with code ${propertyCode}.`);
  process.exit(1);
}

/** The demo connection + link + room mapping + defaults, created once. */
async function ensureDemoConnection() {
  let connection = await prisma.channelConnection.findUnique({ where: { propertyId: property!.id } });
  if (connection && !connection.name.startsWith("Demo channel")) {
    console.error(`${property!.name} already has a real channel connection ("${connection.name}"). Use another --property.`);
    process.exit(1);
  }
  if (!connection) {
    connection = await prisma.channelConnection.create({
      data: {
        enterpriseId: property!.enterpriseId,
        propertyId: property!.id,
        provider: "BEDS24",
        name: `Demo channel (${property!.code})`,
        refreshToken: "demo-not-a-real-token",
        status: "CONNECTED",
      },
    });
  }
  let link = await prisma.channelPropertyLink.findUnique({ where: { connectionId: connection.id } });
  if (!link) {
    link = await prisma.channelPropertyLink.create({
      data: { connectionId: connection.id, propertyId: property!.id, externalPropertyId: `demo-${property!.code}`, syncEnabled: false },
    });
  }
  // Channel room ids 9001, 9002, ... for the property's room types, in name order.
  for (const [i, rt] of property!.roomTypes.entries()) {
    const exists = await prisma.channelRoomTypeMap.findUnique({ where: { roomTypeId: rt.id } });
    if (!exists) {
      await prisma.channelRoomTypeMap.create({ data: { linkId: link.id, roomTypeId: rt.id, externalRoomId: String(9001 + i), shared: true } });
    }
  }
  const ratePlan = property!.ratePlans.find((p) => p.code === "BAR") ?? property!.ratePlans[0];
  await prisma.channelBookingDefaults.upsert({
    where: { linkId: link.id },
    create: { linkId: link.id, ratePlanId: ratePlan.id, mealPlanCode: "NONE" },
    update: {},
  });
  return connection;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
const reservationUrl = (id: string) => `http://localhost:3000/e/${property!.enterprise.slug}/dashboard/reservations/${id}`;

async function deliver(connectionId: string, raw: Record<string, unknown>) {
  return ingestBooking({
    enterpriseId: property!.enterpriseId,
    connectionId,
    raw,
    source: "WEBHOOK",
    parse: beds24Provider.parseBooking,
    isCancelled: beds24Provider.isCancelledStatus,
  });
}

async function findDemo(connectionId: string, externalBookingId: string) {
  const row = await prisma.channelInboundBooking.findUnique({
    where: { connectionId_externalBookingId: { connectionId, externalBookingId } },
  });
  if (!row) {
    console.error(`No demo booking ${externalBookingId}. Run "list" to see them.`);
    process.exit(1);
  }
  return row;
}

/** The booking as the channel last sent it, so cancel/change resend the same booking. */
function lastRaw(row: { rawPayload: string }): Record<string, unknown> {
  try {
    return JSON.parse(row.rawPayload);
  } catch {
    return {};
  }
}

const connection = await ensureDemoConnection();

if (cmd === "create") {
  const n = (await prisma.channelInboundBooking.count({ where: { connectionId: connection.id } })) + 1;
  const externalBookingId = `DEMO-${String(n).padStart(3, "0")}`;
  const arrival = addDays(resolveBusinessDate(property), 14 + n);
  await deliver(connection.id, {
    id: externalBookingId,
    roomId: 9001,
    arrival: ymd(arrival),
    departure: ymd(addDays(arrival, 2)),
    status: "confirmed",
    numAdult: 2,
    numChild: 0,
    firstName: "Demo",
    lastName: `Guest ${n}`,
    email: `demo.guest${n}@example.com`,
    price: 480,
    currency: "USD",
    referer: "Booking.com",
  });
  const row = await findDemo(connection.id, externalBookingId);
  const result = await convertInboundBooking(row.id);
  if (result.status !== "CONVERTED") {
    console.error(`Received ${externalBookingId} but it was not converted: ${result.reason}`);
    process.exit(1);
  }
  console.log(`Created ${externalBookingId}: ${ymd(arrival)} → ${ymd(addDays(arrival, 2))}, 2 adults, from Booking.com.`);
  console.log(`Open: ${reservationUrl(result.reservationId!)}`);
  console.log(`Then: npm run channels:demo -- cancel ${externalBookingId}   (or: change ${externalBookingId})`);
} else if (cmd === "cancel" || cmd === "change") {
  if (!ref) {
    console.error(`Usage: npm run channels:demo -- ${cmd} <ref>`);
    process.exit(1);
  }
  const row = await findDemo(connection.id, ref);
  const raw = lastRaw(row);
  if (cmd === "cancel") {
    await deliver(connection.id, { ...raw, status: "cancelled" });
  } else {
    const a = row.arrival ? addDays(new Date(Date.UTC(row.arrival.getFullYear(), row.arrival.getMonth(), row.arrival.getDate())), 1) : null;
    const d = row.departure ? addDays(new Date(Date.UTC(row.departure.getFullYear(), row.departure.getMonth(), row.departure.getDate())), 1) : null;
    await deliver(connection.id, {
      ...raw,
      ...(a ? { arrival: ymd(a) } : {}),
      ...(d ? { departure: ymd(d) } : {}),
      numAdult: (row.adults ?? 2) + 1,
    });
  }
  const after = await prisma.channelInboundBooking.findUniqueOrThrow({ where: { id: row.id }, include: { reservation: { select: { status: true } } } });
  if (after.pendingAction) {
    console.log(`Flagged for the desk (${after.pendingAction}): ${after.pendingReason}`);
  } else if (cmd === "cancel" && after.reservation?.status === "CANCELLED") {
    console.log("It was safe, so the reservation was cancelled automatically.");
  } else {
    console.log("Delivered. Nothing to apply (the reservation already matches).");
  }
  if (after.reservationId) console.log(`Open: ${reservationUrl(after.reservationId)}`);
} else if (cmd === "list") {
  const rows = await prisma.channelInboundBooking.findMany({
    where: { connectionId: connection.id },
    include: { reservation: { select: { confirmationNo: true, status: true } } },
    orderBy: { receivedAt: "asc" },
  });
  if (rows.length === 0) console.log('No demo bookings yet. Run "create".');
  for (const r of rows) {
    console.log(
      `${r.externalBookingId}  channel:${r.channelStatus}  reservation:${r.reservation ? `${r.reservation.confirmationNo} ${r.reservation.status}` : "-"}` +
        `${r.pendingAction ? `  FLAGGED ${r.pendingAction}` : ""}${r.reservationId ? `  ${reservationUrl(r.reservationId)}` : ""}`
    );
  }
} else {
  console.log("Usage: npm run channels:demo -- create | cancel <ref> | change <ref> | list   [--property VEYO-MAIN]");
}

await prisma.$disconnect();
