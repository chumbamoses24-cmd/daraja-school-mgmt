const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  await prisma.schoolSettings.create({ data: { schoolName: "Daraja Demo School" } });

  const password = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.create({
    data: { email: "admin@school.test", password, role: "ADMIN", firstName: "Grace", lastName: "Mwangi" },
  });

  const teacher1 = await prisma.user.create({
    data: { email: "teacher1@school.test", password, role: "TEACHER", firstName: "John", lastName: "Otieno" },
  });
  const teacher2 = await prisma.user.create({
    data: { email: "teacher2@school.test", password, role: "TEACHER", firstName: "Mary", lastName: "Wanjiru" },
  });

  const parent1 = await prisma.user.create({
    data: { email: "parent1@school.test", password, role: "PARENT", firstName: "Peter", lastName: "Kamau", phone: "0712345678" },
  });
  const parent2 = await prisma.user.create({
    data: { email: "parent2@school.test", password, role: "PARENT", firstName: "Ruth", lastName: "Njeri", phone: "0723456789" },
  });

  const classRoom = await prisma.classRoom.create({
    data: { name: "Grade 7 Blue", level: "Grade 7", teacherId: teacher1.id },
  });

  const student1 = await prisma.student.create({
    data: {
      admissionNo: "ADM001",
      firstName: "Brian",
      lastName: "Kamau",
      dob: new Date("2013-04-12"),
      gender: "Male",
      classRoomId: classRoom.id,
      parentId: parent1.id,
    },
  });
  const student2 = await prisma.student.create({
    data: {
      admissionNo: "ADM002",
      firstName: "Faith",
      lastName: "Njeri",
      dob: new Date("2013-08-02"),
      gender: "Female",
      classRoomId: classRoom.id,
      parentId: parent2.id,
    },
  });

  const math = await prisma.subject.create({ data: { name: "Mathematics", code: "MATH" } });
  const eng = await prisma.subject.create({ data: { name: "English", code: "ENG" } });

  await prisma.classSubject.create({ data: { classRoomId: classRoom.id, subjectId: math.id, teacherId: teacher1.id } });
  await prisma.classSubject.create({ data: { classRoomId: classRoom.id, subjectId: eng.id, teacherId: teacher2.id } });

  const exam = await prisma.exam.create({
    data: { name: "Mid Term Exam", term: 2, year: 2026, classRoomId: classRoom.id },
  });

  await prisma.grade.createMany({
    data: [
      { examId: exam.id, studentId: student1.id, subjectId: math.id, score: 78, maxScore: 100 },
      { examId: exam.id, studentId: student1.id, subjectId: eng.id, score: 65, maxScore: 100 },
      { examId: exam.id, studentId: student2.id, subjectId: math.id, score: 92, maxScore: 100 },
      { examId: exam.id, studentId: student2.id, subjectId: eng.id, score: 88, maxScore: 100 },
    ],
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await prisma.attendance.createMany({
    data: [
      { studentId: student1.id, date: today, status: "PRESENT", markedById: teacher1.id },
      { studentId: student2.id, date: today, status: "LATE", markedById: teacher1.id },
    ],
  });

  const feeStructure = await prisma.feeStructure.create({
    data: { classRoomId: classRoom.id, term: 2, year: 2026, amount: 15000, description: "Term 2 tuition" },
  });

  const invoice1 = await prisma.invoice.create({
    data: { studentId: student1.id, term: 2, year: 2026, amountDue: 15000, amountPaid: 5000, status: "PARTIAL" },
  });
  await prisma.payment.create({
    data: { invoiceId: invoice1.id, amount: 5000, method: "M-Pesa", reference: "QWE123" },
  });

  await prisma.invoice.create({
    data: { studentId: student2.id, term: 2, year: 2026, amountDue: 15000, amountPaid: 15000, status: "PAID" },
  });

  await prisma.timetableSlot.createMany({
    data: [
      { classRoomId: classRoom.id, subjectId: math.id, teacherId: teacher1.id, dayOfWeek: 1, startTime: "08:00", endTime: "08:40" },
      { classRoomId: classRoom.id, subjectId: eng.id, teacherId: teacher2.id, dayOfWeek: 1, startTime: "08:40", endTime: "09:20" },
      { classRoomId: classRoom.id, dayOfWeek: 1, startTime: "09:20", endTime: "09:40", label: "Break" },
    ],
  });

  await prisma.message.create({
    data: {
      senderId: teacher1.id,
      recipientId: parent1.id,
      subject: "Great progress in Math",
      body: "Brian scored 78% in the Mid Term Math exam. Keep encouraging his revision at home.",
    },
  });

  console.log("Seed complete. Demo logins (password: password123):");
  console.log("  admin@school.test");
  console.log("  teacher1@school.test / teacher2@school.test");
  console.log("  parent1@school.test / parent2@school.test");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
