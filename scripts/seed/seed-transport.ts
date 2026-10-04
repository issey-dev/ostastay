import type { PrismaClient } from "@prisma/client";
import { localToUtc, dateToKey, addDaysKey } from "../../src/lib/transport/time";
import { ensureTransportChargeCode } from "../../src/lib/transport/config";
import { rateAmount } from "../../src/lib/transport/pricing";

// Transportation demo data for one property (.agents/docs/TRANSPORTATION_PLAN.md): the module
// switched on, the Maldivian basics (types, airport, jetty, the property), two routes with
// default departure times, an own speedboat fleet and a third-party seaplane operator, rates,
// and today's pickups/drop-offs for the property's arrivals and departures — some already on
// a shared departure, one with a tight connection so the board shows a "Needs attention".
// Idempotent: catalogue rows are matched by code/name, and bookings are only created while
// the property has none.

export async function seedTransport(prisma: PrismaClient, opts: { propertyId: string; userId: string; businessDate: Date }) {
  const { propertyId } = opts;
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  const tz = property.timeZone || "Indian/Maldives";
  const chargeCodeId = (await ensureTransportChargeCode(propertyId)).id;
  await prisma.transportSettings.upsert({
    where: { propertyId },
    update: { enabled: true },
    create: { propertyId, enabled: true, defaultChargeCodeId: chargeCodeId, attentionToleranceMinutes: 60 },
  });

  const type = async (code: string, name: string, mode: string, requiresFlightDetails: boolean) =>
    prisma.transportType.upsert({
      where: { propertyId_code: { propertyId, code } },
      update: {},
      create: { propertyId, code, name, mode, requiresFlightDetails },
    });
  const speedboat = await type("SPB", "Speedboat", "SPEEDBOAT", false);
  const seaplane = await type("SPL", "Seaplane", "SEAPLANE", true);
  await type("FRY", "Public ferry", "FERRY", false);

  const loc = async (code: string, name: string, t: string, notes?: string) =>
    prisma.transportLocation.upsert({
      where: { propertyId_code: { propertyId, code } },
      update: {},
      create: { propertyId, code, name, type: t, notes: notes ?? null },
    });
  const mle = await loc("MLE", "Velana International Airport", "AIRPORT", "Meet at the arrivals hall, hotel counter 12.");
  const seaplaneTerminal = await loc("SPT", "Seaplane terminal (Velana)", "SEAPLANE_PLATFORM");
  const home = await loc("HOME", property.name, "RESORT");
  const village = await loc("MAAF", "Maafushi island", "ISLAND");

  const route = async (code: string, data: { name: string; originId: string; destinationId: string; transportTypeId: string; category: string; durationMinutes: number; departureSlots: string[]; instructions?: string }) =>
    prisma.transportRoute.upsert({
      where: { propertyId_code: { propertyId, code } },
      update: {},
      create: { propertyId, code, direction: "BOTH", ...data },
    });
  const boatRoute = await route("MLE-SPB", {
    name: "Airport – resort by speedboat",
    originId: mle.id,
    destinationId: home.id,
    transportTypeId: speedboat.id,
    category: "AIRPORT_TRANSFER",
    durationMinutes: 45,
    departureSlots: ["10:00", "14:00", "17:00"],
    instructions: "Luggage tagged at the counter; boat leaves from jetty 3.",
  });
  const planeRoute = await route("MLE-SPL", {
    name: "Airport – resort by seaplane",
    originId: seaplaneTerminal.id,
    destinationId: home.id,
    transportTypeId: seaplane.id,
    category: "AIRPORT_TRANSFER",
    durationMinutes: 35,
    departureSlots: ["09:30", "13:30", "15:30"],
  });
  await route("MAAF-SPB", {
    name: "Maafushi island hop",
    originId: village.id,
    destinationId: home.id,
    transportTypeId: speedboat.id,
    category: "LOCAL_TRANSFER",
    durationMinutes: 20,
    departureSlots: ["08:00", "16:00"],
  });

  const provider = async (name: string, kind: string, phone: string) =>
    prisma.transportProvider.upsert({
      where: { propertyId_name: { propertyId, name } },
      update: {},
      create: { propertyId, name, kind, phone, contactName: kind === "OWN" ? "Marine supervisor" : "Operations desk" },
    });
  const own = await provider("Own speedboats", "OWN", "+960 777 1000");
  const air = await provider("Island Aviation seaplanes", "THIRD_PARTY", "+960 333 5544");
  const vessel = async (providerId: string, name: string, transportTypeId: string, capacity: number) =>
    (await prisma.transportVessel.findFirst({ where: { propertyId, providerId, name } })) ??
    prisma.transportVessel.create({ data: { propertyId, providerId, name, transportTypeId, capacity } });
  const marlin = await vessel(own.id, "Blue Marlin", speedboat.id, 12);
  await vessel(own.id, "Sea Breeze", speedboat.id, 8);
  const twinOtter = await vessel(air.id, "Twin Otter 8Q-IAX", seaplane.id, 15);

  if ((await prisma.transportRate.count({ where: { propertyId } })) === 0) {
    await prisma.transportRate.createMany({
      data: [
        { propertyId, routeId: boatRoute.id, direction: "BOTH", pricingBasis: "PER_PERSON", adultPrice: 120, childPrice: 60, infantPrice: 0, chargeCodeId },
        { propertyId, routeId: planeRoute.id, direction: "BOTH", pricingBasis: "PER_PERSON", adultPrice: 560, childPrice: 280, infantPrice: 0, chargeCodeId, providerId: air.id },
      ],
    });
  }

  if ((await prisma.transportBooking.count({ where: { propertyId } })) > 0) return { bookings: 0 };

  const today = dateToKey(opts.businessDate);
  const at = (time: string, day = today) => localToUtc(day, time, tz);
  const arrivals = await prisma.reservation.findMany({
    where: { propertyId, checkInDate: opts.businessDate, status: { in: ["RESERVED", "IN_HOUSE"] } },
    include: { primaryGuest: true },
    take: 4,
  });
  const departures = await prisma.reservation.findMany({
    where: { propertyId, checkOutDate: opts.businessDate, status: { in: ["IN_HOUSE"] } },
    include: { primaryGuest: true },
    take: 3,
  });
  const name = (g: { firstName: string; lastName: string | null; companyName: string | null }) => g.companyName ?? `${g.firstName} ${g.lastName ?? ""}`.trim();
  const rateFor = (routeId: string) => prisma.transportRate.findFirst({ where: { propertyId, routeId } });

  const pickupBoat = await prisma.transportManifest.create({
    data: { propertyId, serviceDate: opts.businessDate, departureAt: at("14:00"), routeId: boatRoute.id, direction: "PICKUP", transportTypeId: speedboat.id, providerId: own.id, vesselId: marlin.id, driverName: "Captain Ahmed", driverContact: "+960 777 1001", status: "CONFIRMED", createdByUserId: opts.userId },
  });
  const dropPlane = await prisma.transportManifest.create({
    data: { propertyId, serviceDate: opts.businessDate, departureAt: at("13:30"), routeId: planeRoute.id, direction: "DROP_OFF", transportTypeId: seaplane.id, providerId: air.id, vesselId: twinOtter.id, status: "OPEN", createdByUserId: opts.userId },
  });

  const flights = [
    { flightNo: "EK652", airline: "Emirates", time: "12:15" },
    { flightNo: "QR672", airline: "Qatar Airways", time: "13:40" }, // 20 min before the 14:00 boat — needs attention
    { flightNo: "SQ452", airline: "Singapore Airlines", time: "10:50" },
    { flightNo: "TK730", airline: "Turkish Airlines", time: "16:05" },
  ];
  let created = 0;
  for (const [i, r] of arrivals.entries()) {
    const f = flights[i % flights.length];
    const onBoat = i < 2;
    const routeId = i === 3 ? planeRoute.id : boatRoute.id;
    const rate = await rateFor(routeId);
    const amount = rate ? rateAmount(rate, { adults: r.adults, children: r.children, infants: r.infants }) : null;
    const flightAt = at(f.time);
    await prisma.transportBooking.create({
      data: {
        propertyId, reservationId: r.id, groupBlockId: r.groupBlockId, guestName: name(r.primaryGuest), direction: "PICKUP",
        status: onBoat ? "ASSIGNED" : i === 2 ? "DRAFT" : "CONFIRMED", serviceDate: opts.businessDate, adults: r.adults, children: r.children, infants: r.infants,
        airline: f.airline, flightNo: f.flightNo, flightAt, flightAtOnManifest: onBoat ? flightAt : null, airportRepUserId: opts.userId,
        meetingNotes: "Arrivals hall, counter 12", routeId, transportTypeId: routeId === planeRoute.id ? seaplane.id : speedboat.id,
        manifestId: onBoat ? pickupBoat.id : null, rateId: rate?.id ?? null, amount, chargeCodeId: rate?.chargeCodeId ?? null,
        billingStatus: amount ? "NOT_BILLED" : "NON_BILLABLE", createdByUserId: opts.userId,
      },
    });
    created++;
  }
  for (const [i, r] of departures.entries()) {
    const rate = await rateFor(planeRoute.id);
    const amount = rate ? rateAmount(rate, { adults: r.adults, children: r.children, infants: r.infants }) : null;
    await prisma.transportBooking.create({
      data: {
        propertyId, reservationId: r.id, groupBlockId: r.groupBlockId, guestName: name(r.primaryGuest), direction: "DROP_OFF",
        status: i === 0 ? "ASSIGNED" : "CONFIRMED", serviceDate: opts.businessDate, adults: r.adults, children: r.children, infants: r.infants,
        airline: "Emirates", flightNo: i === 0 ? "EK653" : "SQ451", flightAt: at(i === 0 ? "16:40" : "19:25"), flightAtOnManifest: i === 0 ? at("16:40") : null,
        routeId: planeRoute.id, transportTypeId: seaplane.id, manifestId: i === 0 ? dropPlane.id : null, departureAt: i === 0 ? null : at("15:30"),
        rateId: rate?.id ?? null, amount, chargeCodeId: rate?.chargeCodeId ?? null, billingStatus: amount ? "NOT_BILLED" : "NON_BILLABLE", createdByUserId: opts.userId,
      },
    });
    created++;
  }
  // A property with no arrivals or departures today (the docs demo) still gets a realistic
  // board: travellers booked without a stay, two of them sharing the 14:00 boat.
  if (arrivals.length === 0 && departures.length === 0) {
    const rate = await rateFor(boatRoute.id);
    const travellers = [
      { name: "Hana Ibrahim", adults: 2, children: 0, flight: flights[0], onBoat: true },
      { name: "Lucas Moreau", adults: 2, children: 1, flight: flights[1], onBoat: true },
      { name: "Priya Nair", adults: 1, children: 0, flight: flights[2], onBoat: false },
    ];
    for (const t of travellers) {
      const amount = rate ? rateAmount(rate, { adults: t.adults, children: t.children, infants: 0 }) : null;
      const flightAt = at(t.flight.time);
      await prisma.transportBooking.create({
        data: {
          propertyId, guestName: t.name, guestContact: "+960 790 0000", direction: "PICKUP", status: t.onBoat ? "ASSIGNED" : "CONFIRMED",
          serviceDate: opts.businessDate, adults: t.adults, children: t.children, airline: t.flight.airline, flightNo: t.flight.flightNo,
          flightAt, flightAtOnManifest: t.onBoat ? flightAt : null, airportRepUserId: opts.userId, meetingNotes: "Arrivals hall, counter 12",
          routeId: boatRoute.id, transportTypeId: speedboat.id, manifestId: t.onBoat ? pickupBoat.id : null, rateId: rate?.id ?? null,
          amount, chargeCodeId: rate?.chargeCodeId ?? null, billingStatus: amount ? "NOT_BILLED" : "NON_BILLABLE", createdByUserId: opts.userId,
        },
      });
      created++;
    }
  }

  // A local traveller with no stay, island-hopping in for lunch tomorrow.
  await prisma.transportBooking.create({
    data: {
      propertyId, guestName: "Ibrahim Waheed", guestContact: "+960 791 2233", direction: "PICKUP", status: "CONFIRMED",
      serviceDate: new Date(`${addDaysKey(today, 1)}T00:00:00.000Z`), adults: 2, departureAt: at("08:00", addDaysKey(today, 1)),
      routeId: (await prisma.transportRoute.findUniqueOrThrow({ where: { propertyId_code: { propertyId, code: "MAAF-SPB" } } })).id,
      transportTypeId: speedboat.id, billingStatus: "NON_BILLABLE", notes: "Day visitor — lunch at the Beach Grill", createdByUserId: opts.userId,
    },
  });
  return { bookings: created + 1 };
}
