import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const tenantId = "00000000-0000-0000-0000-000000000000"

const generateProfiles = () => {
  const adultMales = [
    { firstName: "John", lastName: "Smith", title: "MR", gender: "M", dob: new Date("1980-05-15"), country: "US" },
    { firstName: "Michael", lastName: "Johnson", title: "MR", gender: "M", dob: new Date("1975-08-22"), country: "GB" },
    { firstName: "David", lastName: "Williams", title: "MR", gender: "M", dob: new Date("1992-11-03"), country: "AU" },
    { firstName: "James", lastName: "Brown", title: "MR", gender: "M", dob: new Date("1985-02-18"), country: "US" },
    { firstName: "Robert", lastName: "Jones", title: "MR", gender: "M", dob: new Date("1970-12-09"), country: "CA" },
    { firstName: "William", lastName: "Garcia", title: "MR", gender: "M", dob: new Date("1988-06-30"), country: "ES" },
    { firstName: "Joseph", lastName: "Martinez", title: "MR", gender: "M", dob: new Date("1995-03-14"), country: "MX" },
  ]
  const adultFemales = [
    { firstName: "Mary", lastName: "Davis", title: "MRS", gender: "F", dob: new Date("1982-09-25"), country: "US" },
    { firstName: "Patricia", lastName: "Rodriguez", title: "MS", gender: "F", dob: new Date("1990-07-11"), country: "ES" },
    { firstName: "Jennifer", lastName: "Wilson", title: "MRS", gender: "F", dob: new Date("1978-04-05"), country: "GB" },
    { firstName: "Linda", lastName: "Anderson", title: "MS", gender: "F", dob: new Date("1986-01-20"), country: "CA" },
    { firstName: "Elizabeth", lastName: "Taylor", title: "DR", gender: "F", dob: new Date("1972-10-18"), country: "AU" },
    { firstName: "Barbara", lastName: "Thomas", title: "MRS", gender: "F", dob: new Date("1993-08-08"), country: "US" },
    { firstName: "Susan", lastName: "Moore", title: "MS", gender: "F", dob: new Date("1989-12-01"), country: "GB" },
  ]
  const kids = [
    { firstName: "Tommy", lastName: "Smith", title: "MSTR", gender: "M", dob: new Date("2015-05-20"), country: "US" },
    { firstName: "Sarah", lastName: "Johnson", title: "MISS", gender: "F", dob: new Date("2018-09-12"), country: "GB" },
    { firstName: "Kevin", lastName: "Williams", title: "MSTR", gender: "M", dob: new Date("2020-01-30"), country: "AU" },
    { firstName: "Emily", lastName: "Jones", title: "MISS", gender: "F", dob: new Date("2012-11-15"), country: "CA" },
    { firstName: "Daniel", lastName: "Garcia", title: "MSTR", gender: "M", dob: new Date("2017-07-22"), country: "ES" },
    { firstName: "Jessica", lastName: "Davis", title: "MISS", gender: "F", dob: new Date("2019-04-10"), country: "US" },
  ]

  const profiles = [...adultMales, ...adultFemales, ...kids]
  
  return profiles.map((p, idx) => {
    const isAdult = p.dob < new Date("2008-01-01")
    return {
      tenantId,
      profileType: "GUEST",
      title: p.title,
      firstName: p.firstName,
      lastName: p.lastName,
      gender: p.gender,
      classification: isAdult ? (idx % 5 === 0 ? "VIP" : "REGULAR") : "REGULAR",
      dateOfBirth: p.dob,
      preferredLanguage: "en",
      contacts: {
        create: isAdult ? [{
          contactType: "PRIMARY",
          firstName: p.firstName,
          lastName: p.lastName,
          mobile: `+1 555 010${idx.toString().padStart(2, '0')}`,
          email: `${p.firstName.toLowerCase()}.${p.lastName.toLowerCase()}@example.com`,
          address: `${100 + idx} Main Street`,
          city: "Metropolis",
          country: p.country,
          isPrimary: true
        }] : []
      },
      documents: {
        create: isAdult ? [{
          documentType: "PASSPORT",
          documentNumber: `P${Math.floor(1000000 + Math.random() * 9000000)}`,
          issuingCountry: p.country,
          expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 5)),
          isPrimary: true
        }] : []
      },
      preferences: {
        create: idx % 3 === 0 ? [{
          category: "DIETARY",
          value: "VEGETARIAN"
        }] : []
      }
    }
  })
}

async function main() {
  console.log("Deleting all reservations and dependencies to prevent foreign key errors...")
  await prisma.payment.deleteMany()
  await prisma.folioLineItem.deleteMany()
  await prisma.folio.deleteMany()
  await prisma.roomAssignment.deleteMany()
  await prisma.accompanyingGuest.deleteMany()
  await prisma.reservationTrace.deleteMany()
  await prisma.reservation.deleteMany()

  console.log("Deleting existing GUEST profiles...")
  await prisma.profile.deleteMany({
    where: { profileType: "GUEST" }
  })
  
  console.log("Deleted existing guests.")
  
  const profilesData = generateProfiles()
  
  console.log(`Seeding ${profilesData.length} new GUEST profiles...`)
  
  let count = 0
  for (const p of profilesData) {
    await prisma.profile.create({
      data: p
    })
    count++
  }
  
  console.log(`Successfully seeded ${count} guest profiles!`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
