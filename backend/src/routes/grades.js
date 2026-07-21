const express = require("express");
const PDFDocument = require("pdfkit");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { getGradingSystem, gradeForPercent } = require("../lib/grading");

const router = express.Router();
router.use(requireAuth);

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
  if (requestUser.role === "PARENT" && !exam.published) {
    throw { status: 403, message: "This exam's results haven't been published yet" };
  }

  const totalScore = grades.reduce((sum, g) => sum + g.score, 0);
  const totalMax = grades.reduce((sum, g) => sum + g.maxScore, 0);
  const average = totalMax ? Number(((totalScore / totalMax) * 100).toFixed(1)) : 0;

  return {
    student: { id: student.id, name: `${student.firstName} ${student.lastName}`, admissionNo: student.admissionNo, classRoom: student.classRoom?.name },
    exam,
    subjects: grades.map((g) => {
      const pct = (g.score / g.maxScore) * 100;
      return {
        subject: g.subject.name,
        score: g.score,
        maxScore: g.maxScore,
        percentage: Number(pct.toFixed(1)),
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

router.post("/exams", requireRole("ADMIN", "TEACHER"), async (req, res) => {
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
    published: z.boolean().optional(),
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

  if (req.user.role === "TEACHER") {
    const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { classRoom: true } });
    if (!exam) return res.status(404).json({ error: "Exam not found" });
    const isHomeroomTeacher = exam.classRoom.teacherId === req.user.id;
    if (!isHomeroomTeacher) {
      const assignment = await prisma.classSubject.findUnique({
        where: { classRoomId_subjectId: { classRoomId: exam.classRoomId, subjectId } },
      });
      if (!assignment || assignment.teacherId !== req.user.id) {
        return res.status(403).json({ error: "You are not assigned to teach this subject for this class" });
      }
    }
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

router.get("/", async (req, res) => {
  const { examId, studentId, classRoomId } = req.query;
  const where = {};
  if (examId) where.examId = Number(examId);
  if (studentId) where.studentId = Number(studentId);

  if (req.user.role === "PARENT") {
    const children = await prisma.student.findMany({ where: { parentId: req.user.id }, select: { id: true } });
    where.studentId = { in: children.map((c) => c.id) };
    where.exam = { published: true };
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
function drawReportCardPage(doc, data) {
  const inkColor = "#1B2A4A";
  const mossColor = "#2F6B4F";
  const rustColor = "#C1502E";
  const slateColor = "#232323";
  const lineColor = "#D9D4C6";

  // Header
  doc.fillColor(inkColor).fontSize(22).font("Helvetica-Bold").text("Daraja", 50, 50);
  doc.fillColor(slateColor).fontSize(9).font("Helvetica").text("SCHOOL REGISTER — REPORT CARD", 50, 76);
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
  drawReportCardPage(doc, data);
  doc.end();
});

// Report cards for an entire class, one page per student — same exam.
router.get("/report-cards/class/:classRoomId/:examId/pdf", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const classRoomId = Number(req.params.classRoomId);
  const examId = Number(req.params.examId);

  const students = await prisma.student.findMany({
    where: { classRoomId },
    orderBy: { admissionNo: "asc" },
  });
  if (students.length === 0) return res.status(404).json({ error: "No students found in this class" });

  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { classRoom: { select: { name: true } } } });
  const fileName = `report-cards-${(exam?.classRoom?.name || "class").replace(/\s+/g, "-").toLowerCase()}-${req.params.examId}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);

  for (let i = 0; i < students.length; i++) {
    const data = await buildReportCard(students[i].id, examId, req.user);
    if (i > 0) doc.addPage();
    drawReportCardPage(doc, data);
  }

  doc.end();
});

// Comprehensive per-exam analysis: subject count, total marks, mean score/points, student
// rankings by mean points (merit list), subject means & ranks, and grade distribution
// (overall, per subject, and split by gender) — Zeraki-style exam analysis.
router.get("/exam-analysis/:classRoomId/:examId", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const classRoomId = Number(req.params.classRoomId);
  const examId = Number(req.params.examId);

  const [exam, students, grades, bands] = await Promise.all([
    prisma.exam.findUnique({ where: { id: examId }, include: { classRoom: { select: { name: true, level: true, stream: true } } } }),
    prisma.student.findMany({ where: { classRoomId }, orderBy: { admissionNo: "asc" } }),
    prisma.grade.findMany({ where: { examId, student: { classRoomId } }, include: { subject: true, student: true } }),
    getGradingSystem(),
  ]);

  if (!exam) return res.status(404).json({ error: "Exam not found" });

  const subjectNames = [...new Set(grades.map((g) => g.subject.name))].sort();
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
    const mean = max ? Number(((total / max) * 100).toFixed(1)) : 0;

    const distribution = gradeCount();
    const distributionByGender = { Male: gradeCount(), Female: gradeCount() };
    subjectGrades.forEach((g) => {
      const pct = (g.score / g.maxScore) * 100;
      const { grade } = gradeForPercent(pct, bands);
      distribution[grade] = (distribution[grade] || 0) + 1;
      const genderKey = g.student.gender === "Female" ? "Female" : g.student.gender === "Male" ? "Male" : null;
      if (genderKey) distributionByGender[genderKey][grade] = (distributionByGender[genderKey][grade] || 0) + 1;
    });

    return { subject: name, mean, distribution, distributionByGender };
  });
  subjectStats.sort((a, b) => b.mean - a.mean);
  subjectStats.forEach((s, i) => (s.rank = i + 1));

  // Per-student merit list: subject scores/grades, totals, points, mean points, position
  const studentRows = students.map((s) => {
    const sGrades = grades.filter((g) => g.studentId === s.id);
    const subjects = subjectNames.map((name) => {
      const g = sGrades.find((gr) => gr.subject.name === name);
      if (!g) return { subject: name, score: null, maxScore: null, grade: null, points: null };
      const pct = (g.score / g.maxScore) * 100;
      const { grade, points } = gradeForPercent(pct, bands);
      return { subject: name, score: g.score, maxScore: g.maxScore, grade, points };
    });
    const totalScore = sGrades.reduce((sum, g) => sum + g.score, 0);
    const totalMax = sGrades.reduce((sum, g) => sum + g.maxScore, 0);
    const meanScore = totalMax ? Number(((totalScore / totalMax) * 100).toFixed(1)) : null;
    const totalPoints = subjects.reduce((sum, sub) => sum + (sub.points || 0), 0);
    const gradedSubjectCount = subjects.filter((sub) => sub.points != null).length;
    const meanPoints = gradedSubjectCount ? Number((totalPoints / gradedSubjectCount).toFixed(2)) : null;

    return {
      id: s.id,
      admissionNo: s.admissionNo,
      name: `${s.firstName} ${s.lastName}`,
      gender: s.gender,
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
    ? Number((gradedStudents.reduce((s, st) => s + st.meanScore, 0) / gradedStudents.length).toFixed(1))
    : null;
  const classMeanPoints = gradedStudents.length
    ? Number((gradedStudents.reduce((s, st) => s + (st.meanPoints || 0), 0) / gradedStudents.length).toFixed(2))
    : null;

  const boys = studentRows.filter((s) => s.gender === "Male" && s.meanScore != null);
  const girls = studentRows.filter((s) => s.gender === "Female" && s.meanScore != null);
  const genderComparison = {
    boys: {
      count: boys.length,
      meanScore: boys.length ? Number((boys.reduce((s, b) => s + b.meanScore, 0) / boys.length).toFixed(1)) : null,
    },
    girls: {
      count: girls.length,
      meanScore: girls.length ? Number((girls.reduce((s, g) => s + g.meanScore, 0) / girls.length).toFixed(1)) : null,
    },
  };

  res.json({
    exam,
    classRoom: exam.classRoom,
    subjectCount,
    totalMarks,
    classMeanScore,
    classMeanPoints,
    classDistribution,
    classDistributionByGender,
    genderComparison,
    subjects: subjectStats,
    students: ranked,
  });
});

module.exports = router;
