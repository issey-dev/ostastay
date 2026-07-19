import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const rooms = await prisma.room.findMany({
    where: { roomNumber: "103" },
    include: { assignedAttendant: true, housekeepingTasks: true }
  })
  console.log(JSON.stringify(rooms, null, 2))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
