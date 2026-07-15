import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

async function main() {
  const tenantId = "00000000-0000-0000-0000-000000000000"

  // 1. Get Property
  const property = await prisma.property.findUnique({
    where: { id: "00000000-0000-0000-0000-000000000000" },
    include: { rooms: true, roomTypes: true }
  })
  if (!property) throw new Error("No property with rooms found!")

  // 2. Setup Rate Plan
  let ratePlan = await prisma.ratePlan.findFirst({ where: { propertyId: property.id } })
  if (!ratePlan) {
    ratePlan = await prisma.ratePlan.create({
      data: {
        propertyId: property.id,
        code: "STD",
        name: "Standard Rate",
        description: "Standard daily rate",
        priority: 1
      }
    })
  }

  // 3. Setup Charge Codes and Tax Profiles
  let taxProfile = await prisma.taxProfile.findFirst({ where: { tenantId } })
  if (!taxProfile) {
    taxProfile = await prisma.taxProfile.create({
      data: {
        tenantId,
        name: "Standard Taxes",
        rates: {
          create: [{ ratePercent: 16, effectiveFrom: new Date("2020-01-01") }]
        }
      }
    })
  }

  let rmCode = await prisma.chargeCode.findUnique({ where: { tenantId_code: { tenantId, code: "RM" } } })
  if (!rmCode) {
    rmCode = await prisma.chargeCode.create({
      data: { tenantId, code: "RM", description: "Room Charge", taxProfileId: taxProfile.id }
    })
  }
  
  let fbCode = await prisma.chargeCode.findUnique({ where: { tenantId_code: { tenantId, code: "FB" } } })
  if (!fbCode) {
    fbCode = await prisma.chargeCode.create({
      data: { tenantId, code: "FB", description: "Food & Beverage", taxProfileId: taxProfile.id }
    })
  }

  // Ensure Cash/Card Payment Methods exist
  let pmCard = await prisma.paymentMethod.findFirst({ where: { tenantId, type: "CARD" } })
  if (!pmCard) pmCard = await prisma.paymentMethod.create({ data: { tenantId, name: "Credit Card", type: "CARD" } })

  // 4. Get 5 Profiles
  const profiles = await prisma.profile.findMany({ where: { profileType: "GUEST" }, take: 5 })
  if (profiles.length < 5) throw new Error("Not enough guest profiles!")

  // Helper to gen Conf No
  const genConf = () => "RES" + Math.floor(100000 + Math.random() * 900000).toString()

  console.log("Seeding Scenario A (Future Reservation)...")
  await prisma.reservation.create({
    data: {
      confirmationNo: genConf(),
      propertyId: property.id,
      primaryGuestId: profiles[0].upid,
      checkInDate: new Date(new Date().setMonth(new Date().getMonth() + 1)),
      checkOutDate: new Date(new Date().setMonth(new Date().getMonth() + 1, new Date().getDate() + 3)),
      status: "RESERVED",
    }
  })

  // Open a dummy Cashier Shift for payments
  let user = await prisma.user.findFirst({ where: { tenantId } })
  if (!user) user = await prisma.user.create({ data: { tenantId, email: "admin2@test.com", passwordHash: "x", firstName: "Admin", lastName: "User" } })
  
  const shift = await prisma.cashierShift.create({ data: { tenantId, userId: user.id } })

  console.log("Seeding Scenario B (In-House)...")
  for (let i = 1; i <= 2; i++) {
    await prisma.reservation.create({
      data: {
        confirmationNo: genConf(),
        propertyId: property.id,
        primaryGuestId: profiles[i].upid,
        checkInDate: new Date(new Date().setDate(new Date().getDate() - i)),
        checkOutDate: new Date(new Date().setDate(new Date().getDate() + 2)),
        status: "IN_HOUSE",
        assignments: {
          create: [{
            roomId: property.rooms[i].id,
            roomTypeId: property.rooms[i].roomTypeId,
            ratePlanId: ratePlan.id,
            startDate: new Date(new Date().setDate(new Date().getDate() - i)),
            endDate: new Date(new Date().setDate(new Date().getDate() + 2)),
            overrideRate: 150
          }]
        },
        folios: {
          create: [{
            folioNumber: 1,
            lineItems: {
              create: [
                { chargeCodeId: rmCode.id, date: new Date(), description: "Room Charge", amount: 150, taxAmount: 24, serviceChargeAmount: 15 },
                { chargeCodeId: fbCode.id, date: new Date(), description: "Dinner Restaurant", amount: 85, taxAmount: 13.6, serviceChargeAmount: 8.5 }
              ]
            }
          }]
        }
      }
    })
    // Update Room Status
    await prisma.room.update({ where: { id: property.rooms[i].id }, data: { status: "DIRTY" } }) 
  }

  console.log("Seeding Scenario C (Checked-Out)...")
  for (let i = 3; i <= 4; i++) {
    await prisma.reservation.create({
      data: {
        confirmationNo: genConf(),
        propertyId: property.id,
        primaryGuestId: profiles[i].upid,
        checkInDate: new Date(new Date().setDate(new Date().getDate() - 15 - i)),
        checkOutDate: new Date(new Date().setDate(new Date().getDate() - 10 - i)),
        status: "CHECKED_OUT",
        assignments: {
          create: [{
            roomId: property.rooms[0].id,
            roomTypeId: property.rooms[0].roomTypeId,
            ratePlanId: ratePlan.id,
            startDate: new Date(new Date().setDate(new Date().getDate() - 15 - i)),
            endDate: new Date(new Date().setDate(new Date().getDate() - 10 - i)),
            overrideRate: 200
          }]
        },
        folios: {
          create: [{
            folioNumber: 1,
            isClosed: true,
            lineItems: {
              create: [
                { chargeCodeId: rmCode.id, date: new Date(), description: "Room Charge", amount: 1000, taxAmount: 160, serviceChargeAmount: 100 }
              ]
            },
            payments: {
              create: [{ paymentMethodId: pmCard.id, shiftId: shift.id, amount: 1260 }]
            }
          }]
        }
      }
    })
    
    // Update Guest Stats
    await prisma.profile.update({
      where: { upid: profiles[i].upid },
      data: {
        totalStays: { increment: 1 },
        totalNights: { increment: 5 },
        totalRevenue: { increment: 1260 },
        lastStayDate: new Date(new Date().setDate(new Date().getDate() - 10 - i))
      }
    })
  }

  console.log("Successfully seeded operational data!")
}

main().catch(console.error).finally(() => prisma.$disconnect())
