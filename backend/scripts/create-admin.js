// One-off setup script for a brand new, empty database. Creates the school settings row
// (if missing) and a single real ADMIN account — no demo/placeholder data.
// Run once via Render's Shell tab: node scripts/create-admin.js
// Safe to re-run: it skips anything that already exists instead of erroring.
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const SCHOOL_NAME = "Kabiemit Junior School";
const ADMIN_EMAIL = "chumbamoses97@gmail.com";
const ADMIN_PASSWORD = "e0XtaArm"; // change this after your first login — see Settings
const ADMIN_FIRST_NAME = "Moses";
const ADMIN_LAST_NAME = "Chumba";

async function main() {
  const existingSettings = await prisma.schoolSettings.findFirst();
  if (!existingSettings) {
    await prisma.schoolSettings.create({ data: { schoolName: SCHOOL_NAME } });
    console.log(`Created school settings: ${SCHOOL_NAME}`);
  } else {
    console.log("School settings already exist — left as-is.");
  }

  const existingAdmin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!existingAdmin) {
    const password = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await prisma.user.create({
      data: { email: ADMIN_EMAIL, password, role: "ADMIN", firstName: ADMIN_FIRST_NAME, lastName: ADMIN_LAST_NAME },
    });
    console.log(`Created admin account: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  } else {
    console.log(`An account with ${ADMIN_EMAIL} already exists — left as-is.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
