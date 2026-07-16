const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// ---- Classrooms ----
router.get("/classrooms", async (req, res) => {
  const classRooms = await prisma.classRoom.findMany({
    include: { teacher: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { students: true } } },
  });
  res.json(classRooms);
});

router.post("/classrooms", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({ name: z.string().min(1), level: z.string().min(1), teacherId: z.number().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const classRoom = await prisma.classRoom.create({ data: parsed.data });
  res.status(201).json(classRoom);
});

// Deleting a class also cleans up records that only make sense in the context of that class:
// timetable slots, subject/teacher assignments, fee structures, and exams (with their grades).
// Students in the class are kept, just unassigned (classRoomId set to null) rather than deleted.
router.delete("/classrooms/:id", requireRole("ADMIN"), async (req, res) => {
  const classRoomId = Number(req.params.id);
  const classRoom = await prisma.classRoom.findUnique({ where: { id: classRoomId } });
  if (!classRoom) return res.status(404).json({ error: "Class not found" });

  const exams = await prisma.exam.findMany({ where: { classRoomId }, select: { id: true } });
  const examIds = exams.map((e) => e.id);

  await prisma.$transaction([
    prisma.grade.deleteMany({ where: { examId: { in: examIds } } }),
    prisma.exam.deleteMany({ where: { classRoomId } }),
    prisma.timetableSlot.deleteMany({ where: { classRoomId } }),
    prisma.classSubject.deleteMany({ where: { classRoomId } }),
    prisma.feeStructure.deleteMany({ where: { classRoomId } }),
    prisma.student.updateMany({ where: { classRoomId }, data: { classRoomId: null } }),
    prisma.classRoom.delete({ where: { id: classRoomId } }),
  ]);

  res.status(204).end();
});

// ---- Students / Admissions ----
router.get("/", async (req, res) => {
  const { classRoomId, parentId } = req.query;
  // Parents can only see their own children
  const where = {};
  if (req.user.role === "PARENT") where.parentId = req.user.id;
  if (classRoomId) where.classRoomId = Number(classRoomId);
  if (parentId && req.user.role !== "PARENT") where.parentId = Number(parentId);

  const students = await prisma.student.findMany({
    where,
    include: {
      classRoom: { select: { id: true, name: true, level: true } },
      parent: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
    },
    orderBy: { lastName: "asc" },
  });
  res.json(students);
});

router.get("/:id", async (req, res) => {
  const student = await prisma.student.findUnique({
    where: { id: Number(req.params.id) },
    include: { classRoom: true, parent: true },
  });
  if (!student) return res.status(404).json({ error: "Student not found" });
  if (req.user.role === "PARENT" && student.parentId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.json(student);
});

const studentSchema = z.object({
  admissionNo: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.string(), // ISO date
  gender: z.string().min(1),
  classRoomId: z.number().optional(),
  guardianName: z.string().optional(),
  guardianPhone: z.string().optional(),
  guardianEmail: z.string().email().optional().or(z.literal("")),
  parentId: z.number().optional(),
});

router.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = studentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = { ...parsed.data, dob: new Date(parsed.data.dob) };
  const student = await prisma.student.create({ data });
  res.status(201).json(student);
});

router.put("/:id", requireRole("ADMIN"), async (req, res) => {
  const parsed = studentSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = { ...parsed.data };
  if (data.dob) data.dob = new Date(data.dob);
  const student = await prisma.student.update({ where: { id: Number(req.params.id) }, data });
  res.json(student);
});

// Deleting a student also removes their attendance history, grades, and fee invoices/payments.
router.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  const studentId = Number(req.params.id);
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return res.status(404).json({ error: "Student not found" });

  const invoices = await prisma.invoice.findMany({ where: { studentId }, select: { id: true } });
  const invoiceIds = invoices.map((i) => i.id);

  await prisma.$transaction([
    prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } }),
    prisma.invoice.deleteMany({ where: { studentId } }),
    prisma.grade.deleteMany({ where: { studentId } }),
    prisma.attendance.deleteMany({ where: { studentId } }),
    prisma.student.delete({ where: { id: studentId } }),
  ]);

  res.status(204).end();
});

module.exports = router;
