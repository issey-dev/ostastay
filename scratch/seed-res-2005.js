const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const confirmationNo = "RES-2005";

  // Find the reservation
  const reservation = await prisma.reservation.findUnique({
    where: { confirmationNo },
    include: { folios: true }
  });

  if (!reservation) {
    console.error(`Reservation ${confirmationNo} not found in database.`);
    return;
  }

  console.log(`Found reservation ${reservation.id} with confirmation no ${confirmationNo}.`);

  // Ensure a folio exists
  let folio = reservation.folios[0];
  if (!folio) {
    folio = await prisma.folio.create({
      data: {
        reservationId: reservation.id,
        folioNumber: 1
      }
    });
    console.log(`Created new master folio with ID: ${folio.id}`);
  } else {
    console.log(`Using existing folio with ID: ${folio.id}`);
  }

  // Clear existing items/payments for a clean test
  await prisma.folioLineItem.deleteMany({ where: { folioId: folio.id } });
  await prisma.payment.deleteMany({ where: { folioId: folio.id } });

  // Get a charge code
  let chargeCode = await prisma.chargeCode.findFirst();
  if (!chargeCode) {
    // Create a default charge code if none exists
    const taxProfile = await prisma.taxProfile.findFirst() || await prisma.taxProfile.create({
      data: {
        tenantId: "00000000-0000-0000-0000-000000000000",
        name: "Standard Tax"
      }
    });

    chargeCode = await prisma.chargeCode.create({
      data: {
        tenantId: "00000000-0000-0000-0000-000000000000",
        code: "RM",
        description: "Room Charge",
        taxProfileId: taxProfile.id
      }
    });
  }

  // Get a payment method
  let paymentMethod = await prisma.paymentMethod.findFirst();
  if (!paymentMethod) {
    paymentMethod = await prisma.paymentMethod.create({
      data: {
        tenantId: "00000000-0000-0000-0000-000000000000",
        name: "Credit Card",
        type: "CARD"
      }
    });
  }

  // Create a cashier shift if needed
  let shift = await prisma.cashierShift.findFirst();
  if (!shift) {
    shift = await prisma.cashierShift.create({
      data: {
        tenantId: "00000000-0000-0000-0000-000000000000",
        userId: "system",
        openingFloat: 100.00
      }
    });
  }

  // Add dummy charges (Line Items)
  await prisma.folioLineItem.createMany({
    data: [
      {
        folioId: folio.id,
        chargeCodeId: chargeCode.id,
        date: new Date(reservation.checkInDate),
        description: "Room Charge - Deluxe Room (Night 1)",
        amount: 150.00,
        taxAmount: 15.00
      },
      {
        folioId: folio.id,
        chargeCodeId: chargeCode.id,
        date: new Date(new Date(reservation.checkInDate).getTime() + 24 * 3600 * 1000),
        description: "Room Charge - Deluxe Room (Night 2)",
        amount: 150.00,
        taxAmount: 15.00
      },
      {
        folioId: folio.id,
        chargeCodeId: chargeCode.id,
        date: new Date(reservation.checkInDate),
        description: "Restaurant Dinner - Room Service",
        amount: 45.00,
        taxAmount: 4.50
      },
      {
        folioId: folio.id,
        chargeCodeId: chargeCode.id,
        date: new Date(new Date(reservation.checkInDate).getTime() + 24 * 3600 * 1000),
        description: "Minibar Snacks",
        amount: 12.00,
        taxAmount: 1.20
      }
    ]
  });

  // Add dummy payments
  await prisma.payment.create({
    data: {
      folioId: folio.id,
      paymentMethodId: paymentMethod.id,
      shiftId: shift.id,
      amount: 200.00,
      referenceNumber: "TXN-982173",
      isRefund: false
    }
  });

  console.log("Successfully seeded folio data for RES-2005!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
