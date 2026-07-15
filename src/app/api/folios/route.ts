import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const reservationId = searchParams.get("reservationId");

    if (!reservationId) {
      return NextResponse.json({ error: "Missing reservationId" }, { status: 400 });
    }

    let folios = await prisma.folio.findMany({
      where: { reservationId },
      include: {
        lineItems: {
          include: { chargeCode: true },
          orderBy: { date: 'asc' }
        },
        payments: {
          include: { paymentMethod: true, shift: true },
          orderBy: { createdAt: 'asc' }
        },
        payeeProfile: true,
        reservation: {
          include: {
            primaryGuest: true,
            accompanyingGuests: { include: { profile: true } }
          }
        }
      },
      orderBy: { folioNumber: 'asc' }
    });

    if (folios.length === 0) {
      // Auto-create default folio for legacy or seeded bookings
      const newFolio = await prisma.folio.create({
        data: {
          reservationId,
          folioNumber: 1
        },
        include: {
          lineItems: {
            include: { chargeCode: true },
            orderBy: { date: 'asc' }
          },
          payments: {
            include: { paymentMethod: true, shift: true },
            orderBy: { createdAt: 'asc' }
          },
          payeeProfile: true,
          reservation: {
            include: {
              primaryGuest: true,
              accompanyingGuests: { include: { profile: true } }
            }
          }
        }
      });
      folios = [newFolio];
    }

    return NextResponse.json(folios);
  } catch (error) {
    console.error("Failed to fetch folios:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { reservationId } = body;

    if (!reservationId) {
      return NextResponse.json({ error: "Missing reservationId" }, { status: 400 });
    }

    // Determine the next folio number
    const existingFolios = await prisma.folio.findMany({
      where: { reservationId },
      orderBy: { folioNumber: 'desc' },
      take: 1
    });

    const nextFolioNumber = existingFolios.length > 0 ? existingFolios[0].folioNumber + 1 : 1;

    const newFolio = await prisma.folio.create({
      data: {
        reservationId,
        folioNumber: nextFolioNumber
      },
      include: {
        lineItems: {
          include: { chargeCode: true },
          orderBy: { date: 'asc' }
        },
        payments: {
          include: { paymentMethod: true, shift: true },
          orderBy: { createdAt: 'asc' }
        },
        payeeProfile: true,
        reservation: {
          include: {
            primaryGuest: true,
            accompanyingGuests: { include: { profile: true } }
          }
        }
      }
    });

    return NextResponse.json(newFolio);
  } catch (error) {
    console.error("Failed to create folio:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
