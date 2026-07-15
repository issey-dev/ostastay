import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ReservationStatus } from "@/lib/enums";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get("propertyId");

  try {
    const reservations = await prisma.reservation.findMany({
      where: propertyId ? { propertyId } : undefined,
      include: {
        primaryGuest: true,
        travelAgent: true,
        accompanyingGuests: { include: { profile: true } },
        assignments: {
          include: { 
            roomType: true, 
            room: {
              include: {
                housekeepingTasks: {
                  where: { taskType: 'SPECIAL_REQUEST' },
                  orderBy: { createdAt: 'desc' }
                }
              }
            }, 
            ratePlan: true 
          }
        },
        folios: true,
      },
      orderBy: { checkInDate: 'asc' },
      take: 100, // Limit for dashboard performance
    });
    return NextResponse.json(reservations);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch reservations" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.propertyId || !body.primaryGuestId || !body.checkInDate || !body.checkOutDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Fetch TenantSettings to determine confirmation number format
    const DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000000";
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: DEMO_TENANT_ID }
    });

    const prefix = settings?.resConfirmPrefix || "";
    const length = settings?.resConfirmLength || 6;
    const randomPart = Math.random().toString(36).substring(2, 2 + length).toUpperCase();
    const confirmationNo = `${prefix}${randomPart}`;

    const newReservation = await prisma.reservation.create({
      data: {
        confirmationNo,
        propertyId: body.propertyId,
        primaryGuestId: body.primaryGuestId,
        travelAgentId: body.travelAgentId,
        checkInDate: new Date(body.checkInDate),
        checkOutDate: new Date(body.checkOutDate),
        adults: parseInt(body.adults) || 1,
        children: parseInt(body.children) || 0,
        mealPlan: body.mealPlan || "NONE",
        status: "CONFIRMED", // Default status
        assignments: {
          create: body.assignments ? body.assignments : [
            {
              roomTypeId: body.roomTypeId,
              roomId: body.roomId || null,
              ratePlanId: body.ratePlanId,
              overrideRate: body.overrideRate || null,
              startDate: new Date(body.checkInDate),
              endDate: new Date(body.checkOutDate)
            }
          ]
        },
        accompanyingGuests: Array.isArray(body.accompanyingGuestIds) && body.accompanyingGuestIds.length > 0 ? {
          create: body.accompanyingGuestIds.map((id: string) => ({ profileId: id }))
        } : undefined,
        // Auto-create the Master Folio (Window 1) for the reservation
        folios: {
          create: {
            folioNumber: 1,
          }
        }
      },
      include: {
        primaryGuest: true,
        travelAgent: true,
        accompanyingGuests: { include: { profile: true } },
        assignments: {
          include: { 
            roomType: true, 
            room: {
              include: {
                housekeepingTasks: {
                  where: { taskType: 'SPECIAL_REQUEST' },
                  orderBy: { createdAt: 'desc' }
                }
              }
            }, 
            ratePlan: true 
          }
        },
        folios: true,
      }
    });
    
    return NextResponse.json(newReservation, { status: 201 });
  } catch (error) {
    console.error("Failed to create reservation:", error);
    return NextResponse.json({ error: "Failed to create reservation" }, { status: 500 });
  }
}
