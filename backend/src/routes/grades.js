const express = require("express");
const PDFDocument = require("pdfkit");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { getGradingSystem, gradeForPercent } = require("../lib/grading");
const { sortByAdmissionNo } = require("../lib/sort");

const router = express.Router();
router.use(requireAuth);

// School name + logo shown on every printout — falls back to sensible defaults if Settings
// hasn't been touched yet (getOrCreateSettings in settings.js already guarantees a row exists
// once anyone visits Settings, but grades.js can be hit first on a fresh install).
async function getSchoolBranding() {
  const settings = await prisma.schoolSettings.findFirst();
  return { schoolName: settings?.schoolName || "My School", logo: settings?.logo || null };
}

// Shared builder used by both the JSON report-card route and the PDF route.
// Throws { status, message } on not-found/forbidden so callers can respond appropriately.
async function buildReportCard(studentId, examId, requestUser) {
  if (requestUser.role === "PARENT") {
    const child = await prisma.student.findUnique({ where: { id: studentId } });
    if (!child || child.parentId !== requestUser.id) {
      throw { status: 403, message: "Forbidden" };
    }
  }

  const [student, exam, grades, bands] = await Promise.all([
    prisma.student.findUnique({ where: { id: studentId }, include: { classRoom: true } }),
    prisma.exam.findUnique({ where: { id: examId } }),
    prisma.grade.findMany({ where: { studentId, examId }, include: { subject: true } }),
    getGradingSystem(),
  ]);

  if (!student || !exam) throw { status: 404, message: "Student or exam not found" };
  if (requestUser.role !== "ADMIN" && exam.status !== "PUBLISHED") {
    throw { status: 403, message: "This exam's results haven't been published yet" };
  }

  const totalScore = grades.reduce((sum, g) => sum + g.score, 0);
  const totalMax = grades.reduce((sum, g) => sum + g.maxScore, 0);
  const average = totalMax ? Math.round((totalScore / totalMax) * 100) : 0;

  return {
    student: { id: student.id, name: `${student.firstName} ${student.lastName}`, admissionNo: student.admissionNo, classRoom: student.classRoom?.name },
    exam,
    subjects: grades.map((g) => {
      const pct = (g.score / g.maxScore) * 100;
      return {
        subject: g.subject.name,
        code: g.subject.code,
        score: g.score,
        maxScore: g.maxScore,
        percentage: Math.round(pct),
        grade: gradeForPercent(pct, bands).grade,
        remarks: g.remarks,
      };
    }),
    average,
    overallGrade: gradeForPercent(average, bands).grade,
  };
}

// ---- Grading system ----
router.get("/grading-system", async (req, res) => {
  res.json(await getGradingSystem());
});

router.post("/grading-system", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({
    grade: z.string().min(1),
    minPercent: z.number(),
    maxPercent: z.number(),
    points: z.number(),
    order: z.number().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const band = await prisma.gradeBand.create({ data: parsed.data });
  res.status(201).json(band);
});

router.put("/grading-system/:id", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({
    grade: z.string().min(1).optional(),
    minPercent: z.number().optional(),
    maxPercent: z.number().optional(),
    points: z.number().optional(),
    order: z.number().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const band = await prisma.gradeBand.update({ where: { id: Number(req.params.id) }, data: parsed.data });
  res.json(band);
});

router.delete("/grading-system/:id", requireRole("ADMIN"), async (req, res) => {
  await prisma.gradeBand.delete({ where: { id: Number(req.params.id) } });
  res.status(204).end();
});

// ---- Subjects ----
router.get("/subjects", async (req, res) => {
  res.json(await prisma.subject.findMany());
});

router.post("/subjects", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({ name: z.string().min(1), code: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await prisma.subject.create({ data: parsed.data }));
});

router.put("/subjects/:id", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({ name: z.string().min(1).optional(), code: z.string().min(1).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const subject = await prisma.subject.update({ where: { id: Number(req.params.id) }, data: parsed.data });
  res.json(subject);
});

// ---- Subject assignments (which teacher teaches which subject in which class) ----
router.get("/class-subjects", async (req, res) => {
  const { classRoomId, teacherId } = req.query;
  const where = {};
  if (classRoomId) where.classRoomId = Number(classRoomId);
  if (teacherId) where.teacherId = Number(teacherId);
  // Teachers only see their own assignments unless they're also filtering as admin would
  if (req.user.role === "TEACHER" && !teacherId) where.teacherId = req.user.id;

  const assignments = await prisma.classSubject.findMany({
    where,
    include: {
      classRoom: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true, code: true } },
      teacher: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  res.json(assignments);
});

router.post("/class-subjects", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({ classRoomId: z.number(), subjectId: z.number(), teacherId: z.number() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.classSubject.findUnique({
    where: { classRoomId_subjectId: { classRoomId: parsed.data.classRoomId, subjectId: parsed.data.subjectId } },
  });

  const assignment = existing
    ? await prisma.classSubject.update({ where: { id: existing.id }, data: { teacherId: parsed.data.teacherId } })
    : await prisma.classSubject.create({ data: parsed.data });

  res.status(201).json(assignment);
});

router.delete("/class-subjects/:id", requireRole("ADMIN"), async (req, res) => {
  await prisma.classSubject.delete({ where: { id: Number(req.params.id) } });
  res.status(204).end();
});

// ---- Exams ----
router.get("/exams", async (req, res) => {
  const { classRoomId } = req.query;
  const exams = await prisma.exam.findMany({
    where: classRoomId ? { classRoomId: Number(classRoomId) } : undefined,
    include: { classRoom: { select: { name: true } } },
    orderBy: { id: "desc" },
  });
  res.json(exams);
});

// Only admins create exams — teachers work with exams an admin has already set up.
router.post("/exams", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    term: z.number(),
    year: z.number(),
    classRoomId: z.number(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await prisma.exam.create({ data: parsed.data }));
});

router.put("/exams/:id", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).optional(),
    term: z.number().optional(),
    year: z.number().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const exam = await prisma.exam.update({
    where: { id: Number(req.params.id) },
    data: parsed.data,
    include: { classRoom: { select: { name: true } } },
  });
  res.json(exam);
});

// ---- Two-stage publish workflow ----
// Stage 1 (DRAFT -> LOCKED): marks entry closes for teachers so the admin can review/adjust
// grading before anything goes public. Also reachable to move an exam back to DRAFT so a
// correction sheet can be reopened to subject teachers to fix typing errors.
router.put("/exams/:id/lock", requireRole("ADMIN"), async (req, res) => {
  const exam = await prisma.exam.update({
    where: { id: Number(req.params.id) },
    data: { status: "LOCKED" },
    include: { classRoom: { select: { name: true } } },
  });
  res.json(exam);
});

// Reopens marks entry — used to send a locked/published exam back for correction.
router.put("/exams/:id/unpublish", requireRole("ADMIN"), async (req, res) => {
  const exam = await prisma.exam.update({
    where: { id: Number(req.params.id) },
    data: { status: "DRAFT" },
    include: { classRoom: { select: { name: true } } },
  });
  res.json(exam);
});

// Stage 2 (LOCKED -> PUBLISHED): results become visible to teachers/class teachers/parents.
router.put("/exams/:id/publish", requireRole("ADMIN"), async (req, res) => {
  const exam = await prisma.exam.update({
    where: { id: Number(req.params.id) },
    data: { status: "PUBLISHED" },
    include: { classRoom: { select: { name: true } } },
  });
  res.json(exam);
});

// Deleting an exam also removes any grades recorded against it.
router.delete("/exams/:id", requireRole("ADMIN"), async (req, res) => {
  const examId = Number(req.params.id);
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) return res.status(404).json({ error: "Exam not found" });

  await prisma.$transaction([
    prisma.grade.deleteMany({ where: { examId } }),
    prisma.exam.delete({ where: { id: examId } }),
  ]);

  res.status(204).end();
});

// Shared check: can this user enter/edit/delete grades for this subject in this exam's class?
// Admins always can. Teachers can if they're the homeroom teacher of the class, or specifically
// assigned to teach that subject in that class. Throws { status, message } if not allowed.
async function assertCanGrade(examId, subjectId, user) {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { classRoom: true } });
  if (!exam) throw { status: 404, message: "Exam not found" };
  if (user.role === "ADMIN") return exam;
  if (exam.status !== "DRAFT") {
    throw { status: 403, message: "Marks entry is closed for this exam" };
  }
  const isHomeroomTeacher = exam.classRoom.teacherId === user.id;
  if (isHomeroomTeacher) return exam;
  const assignment = await prisma.classSubject.findUnique({
    where: { classRoomId_subjectId: { classRoomId: exam.classRoomId, subjectId } },
  });
  if (!assignment || assignment.teacherId !== user.id) {
    throw { status: 403, message: "You are not assigned to teach this subject for this class" };
  }
  return exam;
}

// Non-admins can only see analysis, merit lists, and report forms once an exam is fully
// published — before that they only see the raw marks-entry view.
async function assertCanViewAnalysis(examId, user) {
  if (user.role === "ADMIN") return;
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) throw { status: 404, message: "Exam not found" };
  if (exam.status !== "PUBLISHED") {
    throw { status: 403, message: "Results have not been published yet" };
  }
}

// ---- Grades ----
// Bulk enter grades for one subject across a class for a given exam
const bulkGradeSchema = z.object({
  examId: z.number(),
  subjectId: z.number(),
  records: z.array(
    z.object({
      studentId: z.number(),
      score: z.number(),
      maxScore: z.number().optional(),
      remarks: z.string().optional(),
    })
  ),
});

router.post("/", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const parsed = bulkGradeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { examId, subjectId, records } = parsed.data;

  try {
    await assertCanGrade(examId, subjectId, req.user);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || "Could not verify permissions" });
  }

  const results = await Promise.all(
    records.map((r) =>
      prisma.grade.upsert({
        where: { examId_studentId_subjectId: { examId, studentId: r.studentId, subjectId } },
        update: { score: r.score, maxScore: r.maxScore ?? 100, remarks: r.remarks },
        create: {
          examId,
          subjectId,
          studentId: r.studentId,
          score: r.score,
          maxScore: r.maxScore ?? 100,
          remarks: r.remarks,
        },
      })
    )
  );
  res.status(201).json(results);
});

// Bulk delete grades for one or more students, for a given exam/subject — e.g. a mark entered
// for the wrong student. Requires the same grading permission as entering marks.
const bulkDeleteSchema = z.object({
  examId: z.number(),
  subjectId: z.number(),
  studentIds: z.array(z.number()).min(1),
});

router.delete("/", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { examId, subjectId, studentIds } = parsed.data;

  try {
    await assertCanGrade(examId, subjectId, req.user);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || "Could not verify permissions" });
  }

  const result = await prisma.grade.deleteMany({
    where: { examId, subjectId, studentId: { in: studentIds } },
  });
  res.json({ deleted: result.count });
});

// For a given class + exam: every subject assigned to that class, with how many students in the
// class already have a grade recorded — powers the "uploaded / not uploaded" subject list.
router.get("/upload-status/:classRoomId/:examId", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const classRoomId = Number(req.params.classRoomId);
  const examId = Number(req.params.examId);

  const [totalStudents, assignments, grades] = await Promise.all([
    prisma.student.count({ where: { classRoomId } }),
    prisma.classSubject.findMany({
      where: { classRoomId },
      include: { subject: true, teacher: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.grade.groupBy({ by: ["subjectId"], where: { examId, student: { classRoomId } }, _count: { id: true } }),
  ]);

  const gradedCountBySubject = Object.fromEntries(grades.map((g) => [g.subjectId, g._count.id]));

  let subjects;
  if (req.user.role === "TEACHER") {
    const classRoom = await prisma.classRoom.findUnique({ where: { id: classRoomId } });
    const isHomeroomTeacher = classRoom?.teacherId === req.user.id;
    subjects = isHomeroomTeacher ? assignments : assignments.filter((a) => a.teacherId === req.user.id);
  } else {
    subjects = assignments;
  }

  res.json(
    subjects.map((a) => ({
      subjectId: a.subject.id,
      subjectName: a.subject.name,
      teacher: a.teacher ? `${a.teacher.firstName} ${a.teacher.lastName}` : null,
      gradedCount: gradedCountBySubject[a.subject.id] || 0,
      totalStudents,
      uploaded: (gradedCountBySubject[a.subject.id] || 0) > 0,
    }))
  );
});

router.get("/", async (req, res) => {
  const { examId, studentId, classRoomId } = req.query;
  const where = {};
  if (examId) where.examId = Number(examId);
  if (studentId) where.studentId = Number(studentId);

  if (req.user.role === "PARENT") {
    const children = await prisma.student.findMany({ where: { parentId: req.user.id }, select: { id: true } });
    where.studentId = { in: children.map((c) => c.id) };
    where.exam = { status: "PUBLISHED" };
  }

  let grades = await prisma.grade.findMany({
    where,
    include: {
      subject: true,
      student: { select: { id: true, firstName: true, lastName: true, classRoomId: true } },
      exam: true,
    },
  });

  if (classRoomId) grades = grades.filter((g) => g.student.classRoomId === Number(classRoomId));
  res.json(grades);
});

// Report card: all grades for a student in a given exam, with average & simple letter grade
// Draws one report card onto the current page of an open PDFDocument. Does not call doc.end().
function drawReportCardPage(doc, data, branding = { schoolName: "My School", logo: null }) {
  const inkColor = "#1B2A4A";
  const mossColor = "#2F6B4F";
  const rustColor = "#C1502E";
  const slateColor = "#232323";
  const lineColor = "#D9D4C6";

  // Header
  let headerTextX = 50;
  if (branding.logo) {
    try {
      const base64 = branding.logo.split(",").pop();
      doc.image(Buffer.from(base64, "base64"), 50, 45, { fit: [40, 40] });
      headerTextX = 100;
    } catch {
      // Malformed logo data — skip it rather than breaking the whole PDF.
    }
  }
  doc.fillColor(inkColor).fontSize(22).font("Helvetica-Bold").text(branding.schoolName, headerTextX, 50);
  doc.fillColor(slateColor).fontSize(9).font("Helvetica").text("SCHOOL REGISTER — REPORT CARD", headerTextX, 76);
  doc.moveTo(50, 95).lineTo(545, 95).strokeColor(lineColor).lineWidth(1).stroke();

  // Student & exam details
  doc.fillColor(inkColor).fontSize(16).font("Helvetica-Bold").text(data.student.name, 50, 112);
  doc
    .fillColor(slateColor)
    .fontSize(10)
    .font("Helvetica")
    .text(
      `Admission No: ${data.student.admissionNo}   ·   Class: ${data.student.classRoom || "—"}`,
      50,
      134
    );
  doc.text(`${data.exam.name} — Term ${data.exam.term}, ${data.exam.year}`, 50, 150);

  // Overall summary box
  doc.roundedRect(400, 108, 145, 55, 3).strokeColor(lineColor).lineWidth(1).stroke();
  doc.fillColor(slateColor).fontSize(8).font("Helvetica").text("OVERALL AVERAGE", 412, 118);
  doc
    .fillColor(inkColor)
    .fontSize(20)
    .font("Helvetica-Bold")
    .text(`${data.average}%  ·  ${data.overallGrade}`, 412, 132);

  // Table header
  let y = 190;
  const col = { subject: 50, score: 260, pct: 340, grade: 410, remarks: 470 };
  doc.fillColor("#FFFFFF").rect(50, y, 495, 24).fill(inkColor);
  doc.fillColor("#FFFFFF").fontSize(9).font("Helvetica-Bold");
  doc.text("SUBJECT", col.subject + 8, y + 8);
  doc.text("SCORE", col.score, y + 8);
  doc.text("%", col.pct, y + 8);
  doc.text("GRADE", col.grade, y + 8);
  doc.text("REMARKS", col.remarks, y + 8);
  y += 24;

  // Table rows
  doc.font("Helvetica").fontSize(10);
  data.subjects.forEach((s, i) => {
    const rowHeight = 26;
    if (i % 2 === 1) {
      doc.fillColor("#F7F5EE").rect(50, y, 495, rowHeight).fill();
    }
    doc.fillColor(slateColor);
    doc.text(s.subject, col.subject + 8, y + 8, { width: 200 });
    doc.text(`${s.score}/${s.maxScore}`, col.score, y + 8);
    doc.text(`${s.percentage}%`, col.pct, y + 8);

    const gradeColor = ["A", "B"].includes(s.grade) ? mossColor : s.grade === "E" ? rustColor : slateColor;
    doc.fillColor(gradeColor).font("Helvetica-Bold").text(s.grade, col.grade, y + 8);
    doc.fillColor(slateColor).font("Helvetica");

    doc.fontSize(9).text(s.remarks || "—", col.remarks, y + 8, { width: 65 });
    doc.fontSize(10);
    y += rowHeight;
  });

  doc.moveTo(50, y).lineTo(545, y).strokeColor(lineColor).lineWidth(1).stroke();

  if (data.subjects.length === 0) {
    doc.fillColor(slateColor).fontSize(10).text("No grades recorded for this exam yet.", 50, y + 16);
  }

  // Footer
  doc
    .fillColor("#888888")
    .fontSize(8)
    .text(`Generated on ${new Date().toLocaleDateString()} · Daraja School Register`, 50, 780, { align: "center", width: 495 });
}

router.get("/report-card/:studentId/:examId", async (req, res) => {
  try {
    const data = await buildReportCard(Number(req.params.studentId), Number(req.params.examId), req.user);
    res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// Report card as a downloadable PDF — one student
router.get("/report-card/:studentId/:examId/pdf", async (req, res) => {
  let data;
  try {
    data = await buildReportCard(Number(req.params.studentId), Number(req.params.examId), req.user);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const fileName = `report-card-${data.student.name.replace(/\s+/g, "-").toLowerCase()}-${data.exam.term}-${data.exam.year}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);
  drawReportCardPage(doc, data, await getSchoolBranding());
  doc.end();
});

// Report cards for an entire class, one page per student — same exam.
router.get("/report-cards/class/:classRoomId/:examId/pdf", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const classRoomId = Number(req.params.classRoomId);
  const examId = Number(req.params.examId);

  const students = sortByAdmissionNo(await prisma.student.findMany({ where: { classRoomId } }));
  if (students.length === 0) return res.status(404).json({ error: "No students found in this class" });

  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { classRoom: { select: { name: true } } } });
  const fileName = `report-cards-${(exam?.classRoom?.name || "class").replace(/\s+/g, "-").toLowerCase()}-${req.params.examId}.pdf`;

  let pages;
  try {
    pages = await Promise.all(students.map((s) => buildReportCard(s.id, examId, req.user)));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);

  const branding = await getSchoolBranding();
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) doc.addPage();
    drawReportCardPage(doc, pages[i], branding);
  }

  doc.end();
});

// Shared builder for exam analysis — used by the JSON route and all three downloadable PDFs below.
// Streams under the same level (e.g. Grade 8 East / Grade 8 West) are ranked together as one
// class, since they're really one cohort split for logistics rather than separate classes.
// Throws { status, message } on not-found so callers can respond appropriately.
async function buildExamAnalysis(classRoomId, examId) {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { classRoom: true } });
  if (!exam) throw { status: 404, message: "Exam not found" };

  const siblingClassRooms = await prisma.classRoom.findMany({ where: { level: exam.classRoom.level } });
  const siblingClassRoomIds = siblingClassRooms.map((c) => c.id);
  const isMultiStream = siblingClassRooms.length > 1;

  // Sibling exams — same name/term/year, one per stream — so grades recorded under each
  // stream's own Exam row still get pulled into the combined ranking.
  const siblingExams = await prisma.exam.findMany({
    where: { name: exam.name, term: exam.term, year: exam.year, classRoomId: { in: siblingClassRoomIds } },
  });
  const examIds = siblingExams.length ? siblingExams.map((e) => e.id) : [examId];

  const [students, grades, bands] = await Promise.all([
    prisma.student.findMany({ where: { classRoomId: { in: siblingClassRoomIds } } }),
    prisma.grade.findMany({ where: { examId: { in: examIds } }, include: { subject: true, student: true } }),
    getGradingSystem(),
  ]);
  const sortedStudents = sortByAdmissionNo(students);

  const subjectNames = [...new Set(grades.map((g) => g.subject.name))].sort();
  const subjectCodeByName = Object.fromEntries(
    subjectNames.map((name) => {
      const g = grades.find((gr) => gr.subject.name === name);
      return [name, g ? g.subject.code : name.slice(0, 4).toUpperCase()];
    })
  );
  const subjectCount = subjectNames.length;
  const totalMarks = subjectNames.reduce((sum, name) => {
    const oneGrade = grades.find((g) => g.subject.name === name);
    return sum + (oneGrade ? oneGrade.maxScore : 100);
  }, 0);

  const gradeCount = () => Object.fromEntries(bands.map((b) => [b.grade, 0]));

  // Per-subject aggregates: mean score, and grade distribution overall + by gender
  const subjectStats = subjectNames.map((name) => {
    const subjectGrades = grades.filter((g) => g.subject.name === name);
    const total = subjectGrades.reduce((s, g) => s + g.score, 0);
    const max = subjectGrades.reduce((s, g) => s + g.maxScore, 0);
    const mean = max ? Math.round((total / max) * 100) : 0;

    const distribution = gradeCount();
    const distributionByGender = { Male: gradeCount(), Female: gradeCount() };
    subjectGrades.forEach((g) => {
      const pct = (g.score / g.maxScore) * 100;
      const { grade } = gradeForPercent(pct, bands);
      distribution[grade] = (distribution[grade] || 0) + 1;
      const genderKey = g.student.gender === "Female" ? "Female" : g.student.gender === "Male" ? "Male" : null;
      if (genderKey) distributionByGender[genderKey][grade] = (distributionByGender[genderKey][grade] || 0) + 1;
    });

    return { subject: name, code: subjectCodeByName[name], mean, distribution, distributionByGender };
  });
  subjectStats.sort((a, b) => b.mean - a.mean);
  subjectStats.forEach((s, i) => (s.rank = i + 1));

  // Per-student merit list: subject scores/grades, totals, points, mean points, position
  const studentRows = sortedStudents.map((s) => {
    const sGrades = grades.filter((g) => g.studentId === s.id);
    const subjects = subjectNames.map((name) => {
      const g = sGrades.find((gr) => gr.subject.name === name);
      if (!g) return { subject: name, code: subjectCodeByName[name], score: null, maxScore: null, grade: null, points: null };
      const pct = (g.score / g.maxScore) * 100;
      const { grade, points } = gradeForPercent(pct, bands);
      return { subject: name, code: subjectCodeByName[name], score: g.score, maxScore: g.maxScore, grade, points };
    });
    const totalScore = sGrades.reduce((sum, g) => sum + g.score, 0);
    const totalMax = sGrades.reduce((sum, g) => sum + g.maxScore, 0);
    const meanScore = totalMax ? Math.round((totalScore / totalMax) * 100) : null;
    const totalPoints = subjects.reduce((sum, sub) => sum + (sub.points || 0), 0);
    const gradedSubjectCount = subjects.filter((sub) => sub.points != null).length;
    const meanPoints = gradedSubjectCount ? Number((totalPoints / gradedSubjectCount).toFixed(2)) : null;

    return {
      id: s.id,
      admissionNo: s.admissionNo,
      name: `${s.firstName} ${s.lastName}`,
      gender: s.gender,
      streamName: s.classRoomId ? siblingClassRooms.find((c) => c.id === s.classRoomId)?.name : null,
      subjects,
      totalScore,
      meanScore,
      totalPoints,
      meanPoints,
    };
  });

  // Rank by mean points (desc), students with no grades sink to the bottom
  const ranked = [...studentRows].sort((a, b) => (b.meanPoints ?? -1) - (a.meanPoints ?? -1));
  ranked.forEach((s, i) => (s.position = s.meanPoints != null ? i + 1 : null));

  // Class-wide grade distribution, overall and by gender
  const classDistribution = gradeCount();
  const classDistributionByGender = { Male: gradeCount(), Female: gradeCount() };
  grades.forEach((g) => {
    const pct = (g.score / g.maxScore) * 100;
    const { grade } = gradeForPercent(pct, bands);
    classDistribution[grade] = (classDistribution[grade] || 0) + 1;
    const genderKey = g.student.gender === "Female" ? "Female" : g.student.gender === "Male" ? "Male" : null;
    if (genderKey) classDistributionByGender[genderKey][grade] = (classDistributionByGender[genderKey][grade] || 0) + 1;
  });

  const gradedStudents = studentRows.filter((s) => s.meanScore != null);
  const classMeanScore = gradedStudents.length
    ? Math.round(gradedStudents.reduce((s, st) => s + st.meanScore, 0) / gradedStudents.length)
    : null;
  const classMeanPoints = gradedStudents.length
    ? Number((gradedStudents.reduce((s, st) => s + (st.meanPoints || 0), 0) / gradedStudents.length).toFixed(2))
    : null;

  const boys = studentRows.filter((s) => s.gender === "Male" && s.meanScore != null);
  const girls = studentRows.filter((s) => s.gender === "Female" && s.meanScore != null);
  const genderComparison = {
    boys: {
      count: boys.length,
      meanScore: boys.length ? Math.round(boys.reduce((s, b) => s + b.meanScore, 0) / boys.length) : null,
    },
    girls: {
      count: girls.length,
      meanScore: girls.length ? Math.round(girls.reduce((s, g) => s + g.meanScore, 0) / girls.length) : null,
    },
  };

  return {
    exam,
    classRoom: { name: isMultiStream ? exam.classRoom.level : exam.classRoom.name, level: exam.classRoom.level, isMultiStream },
    subjectCount,
    totalMarks,
    classMeanScore,
    classMeanPoints,
    classDistribution,
    classDistributionByGender,
    genderComparison,
    subjects: subjectStats,
    students: ranked,
  };
}

// Comprehensive per-exam analysis: subject count, total marks, mean score/points, student
// rankings by mean points (merit list), subject means & ranks, and grade distribution
// (overall, per subject, and split by gender) — Zeraki-style exam analysis.
router.get("/exam-analysis/:classRoomId/:examId", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  try {
    await assertCanViewAnalysis(Number(req.params.examId), req.user);
    const data = await buildExamAnalysis(Number(req.params.classRoomId), Number(req.params.examId));
    res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// ---- Shared PDF drawing helpers ----
const PDF_INK = "#1B2A4A";
const PDF_MOSS = "#2F6B4F";
const PDF_RUST = "#C1502E";
const PDF_SLATE = "#232323";
const PDF_LINE = "#D9D4C6";

function drawPdfHeader(doc, title, subtitle, pageWidth, margin, branding) {
  let titleY = margin;
  if (branding?.schoolName) {
    let brandX = margin;
    if (branding.logo) {
      try {
        const base64 = branding.logo.split(",").pop();
        doc.image(Buffer.from(base64, "base64"), margin, margin, { fit: [24, 24] });
        brandX = margin + 30;
      } catch {
        // Malformed logo data — skip it rather than breaking the whole PDF.
      }
    }
    doc.fillColor(PDF_SLATE).fontSize(9).font("Helvetica-Bold").text(branding.schoolName.toUpperCase(), brandX, margin + 6);
    titleY = margin + 20;
  }
  doc.fillColor(PDF_INK).fontSize(20).font("Helvetica-Bold").text(title, margin, titleY);
  doc.fillColor(PDF_SLATE).fontSize(9).font("Helvetica").text(subtitle, margin, titleY + 25);
  doc.moveTo(margin, titleY + 44).lineTo(margin + pageWidth, titleY + 44).strokeColor(PDF_LINE).lineWidth(1).stroke();
  return titleY + 55; // y position callers should start drawing content from
}

// Downloadable merit list PDF — position, per-subject score+grade, totals, points.
router.get("/exam-analysis/:classRoomId/:examId/merit-list/pdf", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  let data;
  try {
    await assertCanViewAnalysis(Number(req.params.examId), req.user);
    data = await buildExamAnalysis(Number(req.params.classRoomId), Number(req.params.examId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const fileName = `${data.classRoom.name.replace(/\s+/g, "-").toLowerCase()}-merit-list.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const margin = 30;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin });
  doc.pipe(res);
  const pageWidth = doc.page.width - margin * 2;
  const branding = await getSchoolBranding();

  const contentY = drawPdfHeader(doc, `${data.classRoom.name} — Merit List`, `${data.exam.name} — Term ${data.exam.term}, ${data.exam.year}`, pageWidth, margin, branding);

  const subjectColWidth = Math.min(70, (pageWidth - 260) / Math.max(data.subjectCount, 1));
  const col = { pos: margin, adm: margin + 30, name: margin + 85, subjectsStart: margin + 220 };
  let y = contentY;

  function drawHeaderRow() {
    doc.fillColor("#FFFFFF").rect(margin, y, pageWidth, 20).fill(PDF_INK);
    doc.fillColor("#FFFFFF").fontSize(7).font("Helvetica-Bold");
    doc.text("POS", col.pos + 2, y + 6);
    doc.text("ADM NO", col.adm, y + 6);
    doc.text("NAME", col.name, y + 6);
    data.subjects.forEach((s, i) => {
      doc.text((s.code || s.subject).toUpperCase(), col.subjectsStart + i * subjectColWidth, y + 6, { width: subjectColWidth - 2 });
    });
    const totalsX = col.subjectsStart + data.subjectCount * subjectColWidth;
    doc.text("TOT", totalsX, y + 6);
    doc.text("MEAN%", totalsX + 35, y + 6);
    doc.text("PTS", totalsX + 75, y + 6);
    doc.text("M.PTS", totalsX + 105, y + 6);
    y += 20;
  }

  drawHeaderRow();
  doc.font("Helvetica").fontSize(7.5);
  data.students.forEach((s, i) => {
    if (y > doc.page.height - 40) {
      doc.addPage();
      y = margin;
      drawHeaderRow();
      doc.font("Helvetica").fontSize(7.5);
    }
    const rowHeight = 16;
    if (i % 2 === 1) doc.fillColor("#F7F5EE").rect(margin, y, pageWidth, rowHeight).fill();
    doc.fillColor(PDF_SLATE);
    doc.text(String(s.position ?? "—"), col.pos + 2, y + 4);
    doc.text(s.admissionNo, col.adm, y + 4);
    doc.text(s.name, col.name, y + 4, { width: 130 });
    s.subjects.forEach((sub, j) => {
      const text = sub.score != null ? `${sub.score}(${sub.grade})` : "—";
      doc.text(text, col.subjectsStart + j * subjectColWidth, y + 4, { width: subjectColWidth - 2 });
    });
    const totalsX = col.subjectsStart + data.subjectCount * subjectColWidth;
    doc.text(String(s.totalScore), totalsX, y + 4);
    doc.text(s.meanScore != null ? `${s.meanScore}%` : "—", totalsX + 35, y + 4);
    doc.text(String(s.totalPoints), totalsX + 75, y + 4);
    doc.text(s.meanPoints != null ? String(s.meanPoints) : "—", totalsX + 105, y + 4);
    y += rowHeight;
  });

  doc.end();
});

// Downloadable subject analysis report PDF — every subject's mean, rank, and grade distribution.
router.get("/exam-analysis/:classRoomId/:examId/subjects-report/pdf", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  let data;
  try {
    await assertCanViewAnalysis(Number(req.params.examId), req.user);
    data = await buildExamAnalysis(Number(req.params.classRoomId), Number(req.params.examId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const fileName = `${data.classRoom.name.replace(/\s+/g, "-").toLowerCase()}-subject-analysis.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const margin = 50;
  const doc = new PDFDocument({ size: "A4", margin });
  doc.pipe(res);
  const pageWidth = doc.page.width - margin * 2;

  const contentY = drawPdfHeader(doc, `${data.classRoom.name} — Subject Analysis`, `${data.exam.name} — Term ${data.exam.term}, ${data.exam.year}`, pageWidth, margin, await getSchoolBranding());

  let y = contentY + 5;
  doc.fillColor(PDF_SLATE).fontSize(10).font("Helvetica").text(
    `Subjects: ${data.subjectCount}   ·   Total Marks: ${data.totalMarks}   ·   Class Mean: ${data.classMeanScore ?? "—"}%   ·   Class Mean Points: ${data.classMeanPoints ?? "—"}`,
    margin,
    y
  );
  y += 30;

  data.subjects.forEach((s) => {
    if (y > doc.page.height - 140) {
      doc.addPage();
      y = margin;
    }
    doc.fillColor(PDF_INK).fontSize(12).font("Helvetica-Bold").text(`#${s.rank}  ${s.subject}`, margin, y);
    doc.fillColor(PDF_SLATE).fontSize(10).font("Helvetica").text(`Mean: ${s.mean}%`, margin + 350, y);
    y += 18;

    const gradeLine = Object.entries(s.distribution)
      .filter(([, count]) => count > 0)
      .map(([g, count]) => `${g}: ${count}`)
      .join("   ");
    doc.fontSize(9).fillColor(PDF_SLATE).text(gradeLine || "No grades recorded", margin, y, { width: pageWidth });
    y += 14;

    const boysLine = Object.entries(s.distributionByGender.Male).filter(([, c]) => c > 0).map(([g, c]) => `${g}:${c}`).join(" ");
    const girlsLine = Object.entries(s.distributionByGender.Female).filter(([, c]) => c > 0).map(([g, c]) => `${g}:${c}`).join(" ");
    doc.fontSize(8).fillColor("#666666").text(`Boys — ${boysLine || "none"}   |   Girls — ${girlsLine || "none"}`, margin, y);
    y += 22;

    doc.moveTo(margin, y).lineTo(margin + pageWidth, y).strokeColor(PDF_LINE).lineWidth(0.5).stroke();
    y += 12;
  });

  if (data.subjects.length === 0) {
    doc.fillColor(PDF_SLATE).fontSize(10).text("No grades recorded for this exam yet.", margin, y);
  }

  doc.end();
});

// Downloadable top 10 students PDF — position, name, mean score, points, mean points.
router.get("/exam-analysis/:classRoomId/:examId/top10/pdf", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  let data;
  try {
    await assertCanViewAnalysis(Number(req.params.examId), req.user);
    data = await buildExamAnalysis(Number(req.params.classRoomId), Number(req.params.examId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const top10 = data.students.filter((s) => s.position != null).slice(0, 10);

  const fileName = `${data.classRoom.name.replace(/\s+/g, "-").toLowerCase()}-top-10.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const margin = 50;
  const doc = new PDFDocument({ size: "A4", margin });
  doc.pipe(res);
  const pageWidth = doc.page.width - margin * 2;

  const contentY = drawPdfHeader(doc, `${data.classRoom.name} — Top 10 Students`, `${data.exam.name} — Term ${data.exam.term}, ${data.exam.year}`, pageWidth, margin, await getSchoolBranding());

  let y = contentY;
  const col = { pos: margin, adm: margin + 40, name: margin + 130, total: margin + 300, mean: margin + 370, pts: margin + 440, mpts: margin + 490 };

  doc.fillColor("#FFFFFF").rect(margin, y, pageWidth, 24).fill(PDF_INK);
  doc.fillColor("#FFFFFF").fontSize(9).font("Helvetica-Bold");
  doc.text("POS", col.pos + 5, y + 8);
  doc.text("ADM NO", col.adm, y + 8);
  doc.text("NAME", col.name, y + 8);
  doc.text("TOTAL", col.total, y + 8);
  doc.text("MEAN %", col.mean, y + 8);
  doc.text("POINTS", col.pts, y + 8);
  doc.text("M.PTS", col.mpts, y + 8);
  y += 24;

  doc.font("Helvetica").fontSize(10);
  top10.forEach((s, i) => {
    const rowHeight = 26;
    if (i % 2 === 1) doc.fillColor("#F7F5EE").rect(margin, y, pageWidth, rowHeight).fill();
    const posColor = s.position <= 3 ? PDF_MOSS : PDF_SLATE;
    doc.fillColor(posColor).font("Helvetica-Bold").text(String(s.position), col.pos + 5, y + 8);
    doc.fillColor(PDF_SLATE).font("Helvetica");
    doc.text(s.admissionNo, col.adm, y + 8);
    doc.text(s.name, col.name, y + 8, { width: 160 });
    doc.text(String(s.totalScore), col.total, y + 8);
    doc.text(s.meanScore != null ? `${s.meanScore}%` : "—", col.mean, y + 8);
    doc.text(String(s.totalPoints), col.pts, y + 8);
    doc.text(s.meanPoints != null ? String(s.meanPoints) : "—", col.mpts, y + 8);
    y += rowHeight;
  });

  if (top10.length === 0) {
    doc.fillColor(PDF_SLATE).fontSize(10).text("No graded students found for this exam.", margin, y);
  }

  doc.end();
});

// Correction sheet PDF — sorted by admission number (not ranked), so learners can check their
// own marks and subject teachers can spot and fix typing errors after the 1st publish (LOCKED).
// Admin can then use PUT /exams/:id/unpublish to reopen entry for corrections.
router.get("/exam-analysis/:classRoomId/:examId/correction-sheet/pdf", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const examId = Number(req.params.examId);
  if (req.user.role !== "ADMIN") {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) return res.status(404).json({ error: "Exam not found" });
    if (exam.status === "DRAFT") {
      return res.status(403).json({ error: "Correction sheet isn't available until marks are locked for review" });
    }
  }

  let data;
  try {
    data = await buildExamAnalysis(Number(req.params.classRoomId), examId);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  const students = sortByAdmissionNo(data.students);

  const fileName = `${data.classRoom.name.replace(/\s+/g, "-").toLowerCase()}-correction-sheet.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const margin = 30;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin });
  doc.pipe(res);
  const pageWidth = doc.page.width - margin * 2;
  const branding = await getSchoolBranding();

  const contentY = drawPdfHeader(doc, `${data.classRoom.name} — Correction Sheet`, `${data.exam.name} — Term ${data.exam.term}, ${data.exam.year} — not ranked, for checking only`, pageWidth, margin, branding);

  const subjectColWidth = Math.min(80, (pageWidth - 260) / Math.max(data.subjectCount, 1));
  const col = { adm: margin, name: margin + 55, subjectsStart: margin + 200 };
  let y = contentY;

  function drawHeaderRow() {
    doc.rect(margin, y, pageWidth, 20).strokeColor(PDF_LINE).lineWidth(0.5).stroke();
    doc.fillColor(PDF_INK).fontSize(7).font("Helvetica-Bold");
    doc.text("ADM NO", col.adm + 2, y + 6);
    doc.text("NAME", col.name, y + 6);
    data.subjects.forEach((s, i) => {
      doc.text((s.code || s.subject).toUpperCase(), col.subjectsStart + i * subjectColWidth, y + 6, { width: subjectColWidth - 2 });
    });
    y += 20;
  }

  drawHeaderRow();
  doc.font("Helvetica").fontSize(7.5);
  students.forEach((s) => {
    if (y > doc.page.height - 40) {
      doc.addPage();
      y = margin;
      drawHeaderRow();
      doc.font("Helvetica").fontSize(7.5);
    }
    const rowHeight = 18;
    doc.rect(margin, y, pageWidth, rowHeight).strokeColor(PDF_LINE).lineWidth(0.5).stroke();
    doc.fillColor(PDF_SLATE);
    doc.text(s.admissionNo, col.adm + 2, y + 5);
    doc.text(s.name, col.name, y + 5, { width: 140 });
    s.subjects.forEach((sub, j) => {
      doc.text(sub.score != null ? String(sub.score) : "—", col.subjectsStart + j * subjectColWidth, y + 5, { width: subjectColWidth - 2 });
    });
    y += rowHeight;
  });

  doc.end();
});

module.exports = router;
