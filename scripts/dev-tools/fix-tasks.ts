import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const tasks = await prisma.housekeepingTask.findMany({
    where: { taskType: 'SPECIAL_REQUEST' }
  })
  
  let count = 0
  for (const task of tasks) {
    if (task.notes?.startsWith('EBED')) {
      await prisma.housekeepingTask.update({
        where: { id: task.id },
        data: { notes: task.notes.replace('EBED', 'Extra Bed') }
      })
      count++
    } else if (task.notes?.startsWith('BCOT')) {
      await prisma.housekeepingTask.update({
        where: { id: task.id },
        data: { notes: task.notes.replace('BCOT', 'Baby Cot') }
      })
      count++
    } else if (task.notes?.startsWith('VIP')) {
      await prisma.housekeepingTask.update({
        where: { id: task.id },
        data: { notes: task.notes.replace('VIP', 'VIP Setup') }
      })
      count++
    } else if (task.notes?.startsWith('FRUIT')) {
      await prisma.housekeepingTask.update({
        where: { id: task.id },
        data: { notes: task.notes.replace('FRUIT', 'Fruit Basket') }
      })
      count++
    }
  }
  
  console.log(`Fixed ${count} old tasks!`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
