const express = require("express");
const PDFDocument = require("pdfkit");
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

// Distinct list of levels already in use, so the admin can reuse "Grade 7" instead of retyping it
// when adding another stream under the same level.
router.get("/classrooms/levels", async (req, res) => {
  const rows = await prisma.classRoom.findMany({ select: { level: true }, distinct: ["level"] });
  res.json(rows.map((r) => r.level).sort());
});

router.post("/classrooms", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    level: z.string().min(1),
    stream: z.string().optional(),
    teacherId: z.number().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const classRoom = await prisma.classRoom.create({ data: parsed.data });
  res.status(201).json(classRoom);
});

// Edit a class's name, level, stream, or homeroom teacher (e.g. reassigning to a different teacher).
// Pass teacherId: null explicitly to unassign the homeroom teacher.
router.put("/classrooms/:id", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).optional(),
    level: z.string().min(1).optional(),
    stream: z.string().optional(),
    teacherId: z.number().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const classRoom = await prisma.classRoom.update({
    where: { id: Number(req.params.id) },
    data: parsed.data,
    include: { teacher: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { students: true } } },
  });
  res.json(classRoom);
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

// Class performance analysis: attendance rate, average grades per subject, and per-student summary.
router.get("/classrooms/:id/analysis", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const classRoomId = Number(req.params.id);
  const classRoom = await prisma.classRoom.findUnique({
    where: { id: classRoomId },
    include: { teacher: { select: { firstName: true, lastName: true } } },
  });
  if (!classRoom) return res.status(404).json({ error: "Class not found" });

  const students = await prisma.student.findMany({ where: { classRoomId }, orderBy: { admissionNo: "asc" } });
  const studentIds = students.map((s) => s.id);

  const [attendance, grades] = await Promise.all([
    prisma.attendance.findMany({ where: { studentId: { in: studentIds } } }),
    prisma.grade.findMany({ where: { studentId: { in: studentIds } }, include: { subject: true } }),
  ]);

  const attendanceTotal = attendance.length;
  const attendancePresent = attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const classAttendanceRate = attendanceTotal ? Number(((attendancePresent / attendanceTotal) * 100).toFixed(1)) : null;

  // Average % per subject across all recorded grades for this class
  const bySubject = {};
  grades.forEach((g) => {
    const key = g.subject.name;
    if (!bySubject[key]) bySubject[key] = { total: 0, max: 0 };
    bySubject[key].total += g.score;
    bySubject[key].max += g.maxScore;
  });
  const subjectAverages = Object.entries(bySubject).map(([subject, v]) => ({
    subject,
    average: v.max ? Number(((v.total / v.max) * 100).toFixed(1)) : 0,
  }));

  const classOverallAverage = grades.length
    ? Number(((grades.reduce((s, g) => s + g.score, 0) / grades.reduce((s, g) => s + g.maxScore, 0)) * 100).toFixed(1))
    : null;

  // Per-student quick summary
  const studentSummaries = students.map((s) => {
    const sAttendance = attendance.filter((a) => a.studentId === s.id);
    const sTotal = sAttendance.length;
    const sPresent = sAttendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
    const sGrades = grades.filter((g) => g.studentId === s.id);
    const sScoreTotal = sGrades.reduce((sum, g) => sum + g.score, 0);
    const sScoreMax = sGrades.reduce((sum, g) => sum + g.maxScore, 0);
    return {
      id: s.id,
      admissionNo: s.admissionNo,
      name: `${s.firstName} ${s.lastName}`,
      attendanceRate: sTotal ? Number(((sPresent / sTotal) * 100).toFixed(1)) : null,
      average: sScoreMax ? Number(((sScoreTotal / sScoreMax) * 100).toFixed(1)) : null,
    };
  });

  res.json({
    classRoom: {
      id: classRoom.id,
      name: classRoom.name,
      level: classRoom.level,
      stream: classRoom.stream,
      teacher: classRoom.teacher ? `${classRoom.teacher.firstName} ${classRoom.teacher.lastName}` : null,
    },
    studentCount: students.length,
    classAttendanceRate,
    classOverallAverage,
    subjectAverages,
    students: studentSummaries,
  });
});

// Downloadable class list (admission no, name, gender, guardian contact) as a PDF.
router.get("/classrooms/:id/pdf", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const classRoomId = Number(req.params.id);
  const classRoom = await prisma.classRoom.findUnique({ where: { id: classRoomId } });
  if (!classRoom) return res.status(404).json({ error: "Class not found" });

  const students = await prisma.student.findMany({
    where: { classRoomId },
    orderBy: { admissionNo: "asc" },
  });

  const fileName = `${classRoom.name.replace(/\s+/g, "-").toLowerCase()}-class-list.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);

  const inkColor = "#1B2A4A";
  const slateColor = "#232323";
  const lineColor = "#D9D4C6";

  doc.fillColor(inkColor).fontSize(20).font("Helvetica-Bold").text(classRoom.name, 50, 50);
  doc.fillColor(slateColor).fontSize(9).font("Helvetica").text(`CLASS LIST — ${students.length} students`, 50, 76);
  doc.moveTo(50, 95).lineTo(545, 95).strokeColor(lineColor).lineWidth(1).stroke();

  let y = 115;
  const col = { no: 50, adm: 90, name: 190, gender: 340, guardian: 400 };
  doc.fillColor("#FFFFFF").rect(50, y, 495, 22).fill(inkColor);
  doc.fillColor("#FFFFFF").fontSize(9).font("Helvetica-Bold");
  doc.text("#", col.no + 5, y + 6);
  doc.text("ADM NO", col.adm, y + 6);
  doc.text("NAME", col.name, y + 6);
  doc.text("GENDER", col.gender, y + 6);
  doc.text("GUARDIAN", col.guardian, y + 6);
  y += 22;

  doc.font("Helvetica").fontSize(9);
  students.forEach((s, i) => {
    if (y > 760) {
      doc.addPage();
      y = 50;
    }
    if (i % 2 === 1) doc.fillColor("#F7F5EE").rect(50, y, 495, 20).fill();
    doc.fillColor(slateColor);
    doc.text(String(i + 1), col.no + 5, y + 5);
    doc.text(s.admissionNo, col.adm, y + 5);
    doc.text(`${s.firstName} ${s.lastName}`, col.name, y + 5, { width: 145 });
    doc.text(s.gender || "—", col.gender, y + 5);
    doc.text(s.guardianName || "—", col.guardian, y + 5, { width: 140 });
    y += 20;
  });

  doc.end();
});

// Printable mark sheet: Adm No, Name, Stream, and several blank ruled columns for a teacher to
// record marks by hand. Landscape orientation to leave more room for the blank columns.
router.get("/classrooms/:id/marksheet/pdf", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const classRoomId = Number(req.params.id);
  const classRoom = await prisma.classRoom.findUnique({ where: { id: classRoomId } });
  if (!classRoom) return res.status(404).json({ error: "Class not found" });

  const students = await prisma.student.findMany({
    where: { classRoomId },
    orderBy: { admissionNo: "asc" },
  });

  const fileName = `${classRoom.name.replace(/\s+/g, "-").toLowerCase()}-mark-sheet.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40 });
  doc.pipe(res);

  const inkColor = "#1B2A4A";
  const slateColor = "#232323";
  const lineColor = "#D9D4C6";
  const pageWidth = doc.page.width - 80; // margins on both sides

  doc.fillColor(inkColor).fontSize(20).font("Helvetica-Bold").text(classRoom.name, 40, 40);
  doc.fillColor(slateColor).fontSize(9).font("Helvetica").text(`MARK SHEET — ${students.length} students`, 40, 65);
  doc.moveTo(40, 84).lineTo(40 + pageWidth, 84).strokeColor(lineColor).lineWidth(1).stroke();

  const BLANK_COLUMNS = 6;
  const col = { no: 40, adm: 70, name: 150, stream: 320 };
  const blankStartX = 390;
  const blankWidth = (pageWidth - (blankStartX - 40)) / BLANK_COLUMNS;

  let y = 100;
  const headerHeight = 24;
  doc.fillColor("#FFFFFF").rect(40, y, pageWidth, headerHeight).fill(inkColor);
  doc.fillColor("#FFFFFF").fontSize(9).font("Helvetica-Bold");
  doc.text("#", col.no + 5, y + 8);
  doc.text("ADM NO", col.adm, y + 8);
  doc.text("NAME", col.name, y + 8);
  doc.text("STREAM", col.stream, y + 8);
  for (let i = 0; i < BLANK_COLUMNS; i++) {
    doc.text("", blankStartX + i * blankWidth, y + 8); // reserved, headers left blank for handwriting
  }
  y += headerHeight;

  const rowHeight = 24;
  doc.font("Helvetica").fontSize(9);
  students.forEach((s, i) => {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = 40;
    }
    if (i % 2 === 1) doc.fillColor("#F7F5EE").rect(40, y, pageWidth, rowHeight).fill();
    doc.fillColor(slateColor);
    doc.text(String(i + 1), col.no + 5, y + 7);
    doc.text(s.admissionNo, col.adm, y + 7);
    doc.text(`${s.firstName} ${s.lastName}`, col.name, y + 7, { width: 160 });
    doc.text(classRoom.stream || classRoom.name, col.stream, y + 7, { width: 65 });

    // Ruled blank columns for handwritten marks
    for (let c = 0; c <= BLANK_COLUMNS; c++) {
      const x = blankStartX + c * blankWidth;
      doc.moveTo(x, y).lineTo(x, y + rowHeight).strokeColor(lineColor).lineWidth(0.5).stroke();
    }
    y += rowHeight;
  });
  doc.moveTo(40, y).lineTo(40 + pageWidth, y).strokeColor(lineColor).lineWidth(1).stroke();

  doc.end();
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
  classRoomId: z.number({ required_error: "Stream/class is required" }),
  dob: z.string().optional().or(z.literal("")), // ISO date
  gender: z.string().optional(),
  guardianName: z.string().optional(),
  guardianPhone: z.string().optional(),
  guardianEmail: z.string().email().optional().or(z.literal("")),
  photo: z.string().optional(), // base64 data URI, optional
  parentId: z.number().optional(),
});

router.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = studentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = { ...parsed.data };
  data.dob = data.dob ? new Date(data.dob) : null;
  const student = await prisma.student.create({ data });
  res.status(201).json(student);
});

router.put("/:id", requireRole("ADMIN"), async (req, res) => {
  const parsed = studentSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = { ...parsed.data };
  if (data.dob !== undefined) data.dob = data.dob ? new Date(data.dob) : null;
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
