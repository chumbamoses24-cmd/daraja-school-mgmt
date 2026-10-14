const express = require("express");
const PDFDocument = require("pdfkit");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  getGradingSystem,
  gradeForPercent,
  classTeacherComment,
  headTeacherComment,
  levelForPoints,
  subjectComment,
} = require("../lib/grading");
const { sortByAdmissionNo } = require("../lib/sort");
const { sortBySubjectOrder } = require("../lib/subjectOrder");

const router = express.Router();
router.use(requireAuth);

// School name + logo shown on every printout — falls back to sensible defaults if Settings
// hasn't been touched yet (getOrCreateSettings in settings.js already guarantees a row exists
// once anyone visits Settings, but grades.js can be hit first on a fresh install).
async function getSchoolBranding() {
  const settings = await prisma.schoolSettings.findFirst();
  return {
    schoolName: settings?.schoolName || "My School",
    logo: settings?.logo || null,
    address: settings?.address || null,
    headTeacherName: settings?.headTeacherName || null,
    closingDate: settings?.closingDate || null,
    nextTermBegins: settings?.nextTermBegins || null,
  };
}

// Finds the most recent exam (by year, then term) strictly before the given one that this
// student has at least one grade recorded for, and summarizes how they did — mean score, and
// position/class size when that's still recoverable (it is as long as the student hasn't since
// moved to a different class; Student only tracks its *current* classRoomId, not history).
// Returns null if there's no earlier graded exam to compare against (e.g. their first exam).
async function buildPreviousComparison(student, currentExam) {
  const priorGrades = await prisma.grade.findMany({
    where: {
      studentId: student.id,
      OR: [
        { exam: { year: { lt: currentExam.year } } },
        { exam: { year: currentExam.year, term: { lt: currentExam.term } } },
      ],
    },
    include: { exam: true },
    orderBy: [{ exam: { year: "desc" } }, { exam: { term: "desc" } }],
  });
  if (priorGrades.length === 0) return null;

  const previousExam = priorGrades[0].exam;
  const examGrades = priorGrades.filter((g) => g.examId === previousExam.id);
  const totalMax = examGrades.reduce((s, g) => s + g.maxScore, 0);
  const meanScore = totalMax
    ? Math.round((examGrades.reduce((s, g) => s + g.score, 0) / totalMax) * 100)
    : null;

  let position = null;
  let classSize = null;
  try {
    const previousAnalysis = await buildExamAnalysis(previousExam.classRoomId, previousExam.id);
    const row = previousAnalysis.students.find((s) => s.id === student.id);
    if (row) {
      position = row.position;
      classSize = previousAnalysis.students.length;
    }
  } catch {
    // Previous class/exam no longer resolvable — still show the mean score comparison.
  }

  return {
    examLabel: `${previousExam.name} (T${previousExam.term} ${previousExam.year})`,
    meanScore,
    position,
    classSize,
  };
}

// Shared builder used by both the JSON report-card route and the PDF route. Built on top of
// buildExamAnalysis (defined further below) so the report form uses the exact same combined-
// stream ranking, fixed subject order, and full canonical subject list (blank where ungraded)
// as the merit list and correction sheet — the three documents stay in sync by construction.
// Throws { status, message } on not-found/forbidden so callers can respond appropriately.
async function buildReportCard(studentId, examId, requestUser) {
  if (requestUser.role === "PARENT") {
    const child = await prisma.student.findUnique({ where: { id: studentId } });
    if (!child || child.parentId !== requestUser.id) {
      throw { status: 403, message: "Forbidden" };
    }
  }

  const [student, exam] = await Promise.all([
    prisma.student.findUnique({ where: { id: studentId }, include: { classRoom: true } }),
    prisma.exam.findUnique({ where: { id: examId } }),
  ]);
  if (!student || !exam) throw { status: 404, message: "Student or exam not found" };
  if (requestUser.role !== "ADMIN" && exam.status !== "PUBLISHED") {
    throw { status: 403, message: "This exam's results haven't been published yet" };
  }
  if (!student.classRoomId) throw { status: 400, message: "This student is not assigned to a class" };

  const [analysis, bands, previousComparison] = await Promise.all([
    buildExamAnalysis(student.classRoomId, examId),
    getGradingSystem(),
    buildPreviousComparison(student, exam),
  ]);
  const row = analysis.students.find((s) => s.id === studentId);
  if (!row) throw { status: 404, message: "No results found for this student in this exam" };

  const average = row.meanScore ?? 0;
  const trend =
    previousComparison?.meanScore == null
      ? null
      : average > previousComparison.meanScore
      ? "IMPROVED"
      : average < previousComparison.meanScore
      ? "DROPPED"
      : "SAME";

  // Only this student's own classroom's assignments — a sibling stream (e.g. Grade 8 West)
  // may have a different teacher for the same subject than this student's stream.
  const teacherBySubject = Object.fromEntries(
    analysis.classSubjectTeachers
      .filter((cs) => cs.classRoomId === student.classRoomId)
      .map((cs) => [cs.subjectName, cs.teacherName])
  );

  return {
    student: {
      id: student.id,
      name: `${student.firstName} ${student.lastName}`,
      admissionNo: student.admissionNo,
      classRoom: student.classRoom?.name,
      level: student.classRoom?.level,
    },
    exam,
    subjects: row.subjects.map((s) => ({
      subject: s.subject,
      code: s.code,
      score: s.score,
      maxScore: s.maxScore,
      percentage: s.score != null && s.maxScore ? Math.round((s.score / s.maxScore) * 100) : null,
      grade: s.grade,
      teacher: teacherBySubject[s.subject] || null,
      comment: subjectComment(s.grade),
    })),
    totalScore: row.totalScore,
    totalPoints: row.totalPoints,
    meanPoints: row.meanPoints,
    position: row.position,
    classSize: analysis.students.length,
    average,
    overallGrade: gradeForPercent(average, bands).grade,
    previousComparison: previousComparison ? { ...previousComparison, trend } : null,
    classTeacherComment: classTeacherComment(row.totalPoints),
    headTeacherComment: headTeacherComment(row.totalPoints),
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

// Report card — matches Kabiemit Junior School's official report form template (the .dotx
// Moses supplied): logo + school name/address between two red rule lines, a 3-column info
// block (name/adm, class/total/average, points/position/level), a bordered SUBJECT/MARKS/LEVEL
// breakdown table in fixed canonical subject order, closing-date/next-term line, a class
// teacher's remarks area, and a head teacher signature line, closed off with a red+navy rule.
// Draws one report card onto the current page of an open PDFDocument. Does not call doc.end().
const REPORT_RED = "#C00000";
const REPORT_BROWN = "#833C0B";
const REPORT_INK = "#1B2A4A";
const REPORT_SLATE = "#232323";
const REPORT_BORDER = "#444444";

function dottedLine(doc, x1, x2, y, color = REPORT_SLATE) {
  doc.save();
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(0.75).dash(1.5, { space: 2 }).stroke();
  doc.restore();
}

function drawReportCardPage(doc, data, branding = { schoolName: "My School", logo: null }) {
  const margin = 50;
  const pageWidth = doc.page.width - margin * 2;
  let y = margin;

  // Top red rule
  doc.rect(margin, y, pageWidth, 3).fill(REPORT_RED);
  y += 10;

  // Logo + school name/address
  const headerTop = y;
  let textX = margin;
  if (branding.logo) {
    try {
      const base64 = branding.logo.split(",").pop();
      doc.image(Buffer.from(base64, "base64"), margin, headerTop, { fit: [72, 58] });
      textX = margin + 85;
    } catch {
      // Malformed logo data — skip it rather than breaking the whole PDF.
    }
  }
  doc.fillColor(REPORT_BROWN).font("Helvetica-Bold").fontSize(16).text(branding.schoolName.toUpperCase(), textX, headerTop + 8);
  if (branding.address) {
    doc.fontSize(11).text(branding.address, textX, headerTop + 30);
  }
  y = headerTop + 60;

  // Bottom red rule of the header block
  doc.rect(margin, y, pageWidth, 2.5).fill(REPORT_RED);
  y += 22;

  // Info block — a bordered 3x3 table (matches the real form's TableGrid-styled cells): NAME
  // spans the first two columns, then ADM; then two plain 3-up rows.
  const infoColW = [270, 112, 113];
  const infoRowHeight = 24;
  const drawInfoCell = (x, cw, label, value) => {
    doc.rect(x, y, cw, infoRowHeight).strokeColor(REPORT_BORDER).lineWidth(0.75).stroke();
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .fillColor(REPORT_SLATE)
      .text(label, x + 6, y + 7, { continued: true })
      .font("Helvetica")
      .text(` ${value ?? "—"}`, { width: cw - 12 });
  };
  drawInfoCell(margin, infoColW[0] + infoColW[1], "NAME:", data.student.name);
  drawInfoCell(margin + infoColW[0] + infoColW[1], infoColW[2], "ADM:", data.student.admissionNo);
  y += infoRowHeight;
  drawInfoCell(margin, infoColW[0], "CLASS:", data.student.classRoom || "—");
  drawInfoCell(margin + infoColW[0], infoColW[1], "TOTAL MARKS:", data.totalScore);
  drawInfoCell(margin + infoColW[0] + infoColW[1], infoColW[2], "AVERAGE:", `${data.average}%`);
  y += infoRowHeight;
  drawInfoCell(margin, infoColW[0], "TOTAL POINTS:", data.totalPoints);
  drawInfoCell(margin + infoColW[0], infoColW[1], "POSITION:", `${data.position ?? "—"} out of ${data.classSize}`);
  drawInfoCell(margin + infoColW[0] + infoColW[1], infoColW[2], "LEVEL:", data.overallGrade);
  y += infoRowHeight;

  // Comparison against the student's last exam, where one exists — blank (first exam on record)
  // otherwise rather than showing a misleading dash for every field.
  const prev = data.previousComparison;
  drawInfoCell(margin, infoColW[0], "PREVIOUS EXAM:", prev ? `${prev.examLabel} — ${prev.meanScore ?? "—"}%` : "—");
  drawInfoCell(margin + infoColW[0], infoColW[1], "PREV. POSITION:", prev?.position ? `${prev.position}/${prev.classSize}` : "—");
  drawInfoCell(margin + infoColW[0] + infoColW[1], infoColW[2], "TREND:", prev?.trend || "—");
  y += infoRowHeight + 16;

  doc.font("Helvetica-Bold").fontSize(11).text("BREAKDOWN", margin, y);
  y += 20;

  // Breakdown table — fixed columns, bordered, plain lines (no highlighted banding). COMMENT
  // is auto-generated per subject (subjectComment() in grading.js), banded on that subject's
  // own grade, so it fits one line without wrapping.
  const colW = { subject: 140, marks: 55, level: 50, teacher: 90, comment: 160 };
  const rowHeight = 22;
  const drawRow = (cells, { header = false } = {}) => {
    doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(header ? 9.5 : 8.5).fillColor(REPORT_SLATE);
    let x = margin;
    [["subject", cells[0]], ["marks", cells[1]], ["level", cells[2]], ["teacher", cells[3]], ["comment", cells[4]]].forEach(([key, text]) => {
      doc.rect(x, y, colW[key], rowHeight).strokeColor(REPORT_BORDER).lineWidth(0.75).stroke();
      doc.text(String(text ?? ""), x + 5, y + 6, { width: colW[key] - 8 });
      x += colW[key];
    });
    y += rowHeight;
  };
  drawRow(["SUBJECT", "MARKS", "LEVEL", "TEACHER", "COMMENT"], { header: true });
  data.subjects.forEach((s) => {
    drawRow([s.subject, s.score ?? "", s.grade ?? "", s.teacher ?? "—", s.comment ?? ""]);
  });
  y += 20;

  // Closing date / next term — fixed label positions with either the configured date text or
  // a blank dotted line in the gap, since continued text chains don't reserve space for a dash.
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(REPORT_SLATE);
  doc.text("CLOSING DATE:", margin, y);
  if (branding.closingDate) {
    doc.font("Helvetica").text(branding.closingDate, margin + 95, y);
  } else {
    dottedLine(doc, margin + 95, margin + 230, y + 8);
  }
  doc.font("Helvetica-Bold").text("NEXT TERM BEGINS:", margin + 250, y);
  if (branding.nextTermBegins) {
    doc.font("Helvetica").text(branding.nextTermBegins, margin + 365, y);
  } else {
    dottedLine(doc, margin + 365, margin + pageWidth, y + 8);
  }
  y += 30;

  // Class teacher's remarks — auto-generated from the student's total points, replacing the
  // handwritten line on the paper form. Wraps onto the dotted line below if it runs long.
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(REPORT_SLATE).text("CLASS TEACHER'S REMARKS:", margin, y);
  doc.font("Helvetica-Oblique").fontSize(9).text(data.classTeacherComment || "", margin + 175, y, { width: margin + pageWidth - (margin + 175) });
  y += 20;
  dottedLine(doc, margin, margin + pageWidth, y + 8);
  y += 32;
  doc.font("Helvetica-Bold").text("SIGNATURE", margin + 220, y);
  dottedLine(doc, margin + 300, margin + pageWidth, y + 8);
  y += 40;

  // Head teacher's remarks — auto-generated from the student's total points (same bands as the
  // class teacher's comment, coarser wording), printed just above the head teacher's signature.
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(REPORT_SLATE).text("HEAD TEACHER'S REMARKS:", margin, y);
  doc.font("Helvetica-Oblique").fontSize(9).text(data.headTeacherComment || "", margin + 175, y, { width: margin + pageWidth - (margin + 175) });
  y += 20;
  dottedLine(doc, margin, margin + pageWidth, y + 8);
  y += 32;

  dottedLine(doc, margin, margin + 380, y);
  y += 14;
  doc.font("Helvetica-Bold").fontSize(10).text(branding.headTeacherName || "", margin, y);
  y += 16;
  doc.text("HEAD TEACHER", margin, y);
  doc.text("SIGNATURE", margin + 220, y);
  dottedLine(doc, margin + 300, margin + pageWidth, y + 9);

  // Footer rule — thin red over navy, matching the paper form's closing bar
  const footerY = doc.page.height - 60;
  doc.rect(margin, footerY, pageWidth, 1.5).fill(REPORT_RED);
  doc.rect(margin, footerY + 4, pageWidth, 2.5).fill(REPORT_INK);
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

  const [students, grades, classSubjects, bands] = await Promise.all([
    prisma.student.findMany({ where: { classRoomId: { in: siblingClassRoomIds } } }),
    prisma.grade.findMany({ where: { examId: { in: examIds } }, include: { subject: true, student: true } }),
    prisma.classSubject.findMany({
      where: { classRoomId: { in: siblingClassRoomIds } },
      include: { subject: true, teacher: { select: { firstName: true, lastName: true } } },
    }),
    getGradingSystem(),
  ]);
  const sortedStudents = sortByAdmissionNo(students);

  // Previous-exam deviation — mean % for each student on the most recent earlier exam for this
  // class (by year/term), so the merit list can show how each student moved since last time.
  // Deliberately lightweight (just score totals, not a full buildExamAnalysis) to avoid deep
  // recursion through a school's exam history. Blank/empty if there's no earlier exam yet.
  let previousMeanByStudent = {};
  try {
    const priorExams = await prisma.exam.findMany({
      where: {
        classRoomId: { in: siblingClassRoomIds },
        OR: [{ year: { lt: exam.year } }, { year: exam.year, term: { lt: exam.term } }],
      },
      orderBy: [{ year: "desc" }, { term: "desc" }],
    });
    if (priorExams.length) {
      const prevExam = priorExams[0];
      const prevSiblingExams = await prisma.exam.findMany({
        where: { name: prevExam.name, term: prevExam.term, year: prevExam.year, classRoomId: { in: siblingClassRoomIds } },
      });
      const prevExamIds = prevSiblingExams.length ? prevSiblingExams.map((e) => e.id) : [prevExam.id];
      const prevGrades = await prisma.grade.findMany({ where: { examId: { in: prevExamIds } } });
      const byStudent = {};
      prevGrades.forEach((g) => {
        if (!byStudent[g.studentId]) byStudent[g.studentId] = { total: 0, max: 0 };
        byStudent[g.studentId].total += g.score;
        byStudent[g.studentId].max += g.maxScore;
      });
      Object.entries(byStudent).forEach(([sid, { total, max }]) => {
        previousMeanByStudent[Number(sid)] = max ? Math.round((total / max) * 100) : null;
      });
    }
  } catch {
    // No earlier exam, or it's no longer resolvable — deviations stay blank.
  }

  // Subject columns come from what's actually assigned to the class, not just what's been
  // graded so far — so the breakdown table (and report card) always shows every subject the
  // class takes, blank where marks haven't been entered yet, instead of that subject's column
  // disappearing entirely.
  const assignedSubjectNames = classSubjects.map((cs) => cs.subject.name);
  const gradedSubjectNames = grades.map((g) => g.subject.name);
  const subjectNames = sortBySubjectOrder([...new Set([...assignedSubjectNames, ...gradedSubjectNames])], (n) => n);
  const subjectCodeByName = Object.fromEntries(
    subjectNames.map((name) => {
      const g = grades.find((gr) => gr.subject.name === name);
      if (g) return [name, g.subject.code];
      const cs = classSubjects.find((cs) => cs.subject.name === name);
      return [name, cs ? cs.subject.code : name.slice(0, 4).toUpperCase()];
    })
  );
  const subjectCount = subjectNames.length;
  const totalMarks = subjectNames.reduce((sum, name) => {
    const oneGrade = grades.find((g) => g.subject.name === name);
    return sum + (oneGrade ? oneGrade.maxScore : 100);
  }, 0);

  const gradeCount = () => Object.fromEntries(bands.map((b) => [b.grade, 0]));

  // Per-subject aggregates: mean score, and grade distribution overall + by gender
  const subjectStats = subjectNames.filter((name) => gradedSubjectNames.includes(name)).map((name) => {
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
      if (!g) return { subject: name, code: subjectCodeByName[name], score: null, maxScore: null, percentage: null, grade: null, points: null };
      const pct = (g.score / g.maxScore) * 100;
      const { grade, points } = gradeForPercent(pct, bands);
      return { subject: name, code: subjectCodeByName[name], score: g.score, maxScore: g.maxScore, percentage: Math.round(pct), grade, points };
    });
    const totalScore = sGrades.reduce((sum, g) => sum + g.score, 0);
    const totalMax = sGrades.reduce((sum, g) => sum + g.maxScore, 0);
    const meanScore = totalMax ? Math.round((totalScore / totalMax) * 100) : null;
    const totalPoints = subjects.reduce((sum, sub) => sum + (sub.points || 0), 0);
    const gradedSubjectCount = subjects.filter((sub) => sub.points != null).length;
    const meanPoints = gradedSubjectCount ? Number((totalPoints / gradedSubjectCount).toFixed(2)) : null;
    const previousMeanScore = previousMeanByStudent[s.id] ?? null;
    const deviation = meanScore != null && previousMeanScore != null ? meanScore - previousMeanScore : null;

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
      level: levelForPoints(totalPoints),
      previousMeanScore,
      deviation,
      sat: gradedSubjectCount > 0,
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

  // Column headers for the merit list / ranked marks table, in the fixed subject order — kept
  // separate from `subjects` below, which is sorted by mean score for the subject-ranking view.
  const subjectColumns = subjectNames.map((name) => ({ name, code: subjectCodeByName[name] }));

  // Raw class→subject→teacher assignments, kept per-stream (not deduped like subjectColumns)
  // so buildReportCard can look up the right teacher for a specific student's own classroom —
  // two streams of the same level can have different teachers for the same subject.
  const classSubjectTeachers = classSubjects.map((cs) => ({
    classRoomId: cs.classRoomId,
    subjectName: cs.subject.name,
    teacherName: cs.teacher ? `${cs.teacher.firstName} ${cs.teacher.lastName}` : null,
  }));

  return {
    exam,
    classRoom: { name: isMultiStream ? exam.classRoom.level : exam.classRoom.name, level: exam.classRoom.level, isMultiStream },
    subjectCount,
    subjectColumns,
    classSubjectTeachers,
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

// Downloadable merit list PDF — position, per-subject percentage+grade, points, level, and
// deviation from the student's previous exam. Students who never sat this exam (no marks in
// any subject) are left off, same as the on-screen preview. Fits on one landscape page: tight
// column widths, small font, and a bordered grid (no zebra striping) per Moses's request.
router.get("/exam-analysis/:classRoomId/:examId/merit-list/pdf", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  let data;
  try {
    await assertCanViewAnalysis(Number(req.params.examId), req.user);
    data = await buildExamAnalysis(Number(req.params.classRoomId), Number(req.params.examId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  const meritStudents = data.students.filter((s) => s.sat);
  const subjectMeanByName = Object.fromEntries(data.subjects.map((s) => [s.subject, s.mean]));

  const fileName = `${data.classRoom.name.replace(/\s+/g, "-").toLowerCase()}-merit-list.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const margin = 24;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin });
  doc.pipe(res);
  const pageWidth = doc.page.width - margin * 2;
  const branding = await getSchoolBranding();

  const contentY = drawPdfHeader(doc, `${data.classRoom.name} — Merit List`, `${data.exam.name} — Term ${data.exam.term}, ${data.exam.year}`, pageWidth, margin, branding);

  // Fixed-width columns on the left (pos/adm/name) and right (mean/pts/m.pts/level/dev); the
  // subject columns split whatever width is left so the whole table fits on one page.
  const col = { pos: margin, adm: margin + 20, name: margin + 60 };
  const rightColW = { mean: 36, pts: 24, mpts: 32, level: 30, dev: 28 };
  const rightTotalW = Object.values(rightColW).reduce((a, b) => a + b, 0);
  const subjectsStart = margin + 150;
  const subjectColWidth = Math.max(26, Math.min(56, (pageWidth - 150 - rightTotalW) / Math.max(data.subjectCount, 1)));
  const totalsX = subjectsStart + data.subjectCount * subjectColWidth;
  const rightX = {
    mean: totalsX,
    pts: totalsX + rightColW.mean,
    mpts: totalsX + rightColW.mean + rightColW.pts,
    level: totalsX + rightColW.mean + rightColW.pts + rightColW.mpts,
    dev: totalsX + rightColW.mean + rightColW.pts + rightColW.mpts + rightColW.level,
  };
  const tableRight = rightX.dev + rightColW.dev;
  let y = contentY;

  function drawHeaderRow() {
    doc.fillColor("#FFFFFF").rect(margin, y, tableRight - margin, 18).fill(PDF_INK);
    doc.fillColor("#FFFFFF").fontSize(6.5).font("Helvetica-Bold");
    doc.text("POS", col.pos + 2, y + 6, { width: 18 });
    doc.text("ADM NO", col.adm, y + 6, { width: 40 });
    doc.text("NAME", col.name, y + 6, { width: 88 });
    // Headers must follow subjectColumns (fixed SUBJECT_ORDER), the same order each row's
    // `subjects` array is built in — not the mean-ranked `data.subjects` (see buildExamAnalysis).
    data.subjectColumns.forEach((s, i) => {
      doc.text((s.code || s.name).toUpperCase(), subjectsStart + i * subjectColWidth, y + 6, { width: subjectColWidth - 2 });
    });
    doc.text("MEAN%", rightX.mean, y + 6, { width: rightColW.mean - 2 });
    doc.text("PTS", rightX.pts, y + 6, { width: rightColW.pts - 2 });
    doc.text("M.PTS", rightX.mpts, y + 6, { width: rightColW.mpts - 2 });
    doc.text("LEVEL", rightX.level, y + 6, { width: rightColW.level - 2 });
    doc.text("DEV", rightX.dev, y + 6, { width: rightColW.dev - 2 });
    y += 18;
  }

  function drawGridRow(rowHeight, { bold = false } = {}) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(6.5).fillColor(PDF_SLATE);
    doc.rect(margin, y, tableRight - margin, rowHeight).strokeColor(PDF_LINE).lineWidth(0.5).stroke();
  }

  drawHeaderRow();
  meritStudents.forEach((s) => {
    if (y > doc.page.height - 50) {
      doc.addPage();
      y = margin;
      drawHeaderRow();
    }
    const rowHeight = 15;
    drawGridRow(rowHeight);
    doc.text(String(s.position ?? "—"), col.pos + 2, y + 4, { width: 18 });
    doc.text(s.admissionNo, col.adm, y + 4, { width: 40 });
    doc.text(s.name, col.name, y + 4, { width: 88 });
    s.subjects.forEach((sub, j) => {
      const text = sub.percentage != null ? `${sub.percentage}(${sub.grade})` : "—";
      doc.text(text, subjectsStart + j * subjectColWidth, y + 4, { width: subjectColWidth - 2 });
    });
    doc.text(s.meanScore != null ? `${s.meanScore}%` : "—", rightX.mean, y + 4, { width: rightColW.mean - 2 });
    doc.text(String(s.totalPoints), rightX.pts, y + 4, { width: rightColW.pts - 2 });
    doc.text(s.meanPoints != null ? String(s.meanPoints) : "—", rightX.mpts, y + 4, { width: rightColW.mpts - 2 });
    doc.text(s.level || "—", rightX.level, y + 4, { width: rightColW.level - 2 });
    const devText = s.deviation == null ? "—" : s.deviation > 0 ? `+${s.deviation}` : String(s.deviation);
    doc.text(devText, rightX.dev, y + 4, { width: rightColW.dev - 2 });
    y += rowHeight;
  });

  if (meritStudents.length === 0) {
    doc.fillColor(PDF_SLATE).fontSize(9).font("Helvetica").text("No students have sat this exam yet.", margin, y + 6);
  } else {
    // Subject-averages row, directly after the last position.
    const avgRowHeight = 16;
    drawGridRow(avgRowHeight, { bold: true });
    doc.text("AVERAGE", col.name, y + 5, { width: 88 });
    data.subjectColumns.forEach((s, j) => {
      const mean = subjectMeanByName[s.name];
      doc.text(mean != null ? `${mean}%` : "—", subjectsStart + j * subjectColWidth, y + 5, { width: subjectColWidth - 2 });
    });
    doc.text(data.classMeanScore != null ? `${data.classMeanScore}%` : "—", rightX.mean, y + 5, { width: rightColW.mean - 2 });
    doc.text(data.classMeanPoints != null ? String(data.classMeanPoints) : "—", rightX.mpts, y + 5, { width: rightColW.mpts - 2 });
    y += avgRowHeight + 16;

    // Page 2, same document: overall grade distribution and subject mean/rank, both as
    // bordered tables, per Moses's request.
    doc.addPage();
    y = margin;
    doc.font("Helvetica-Bold").fontSize(13).fillColor(PDF_INK).text(`${data.classRoom.name} — Grade Distribution & Subject Ranking`, margin, y);
    y += 24;

    y = drawDistributionTable(doc, { x: margin, y, width: pageWidth, distribution: data.classDistribution });
    y += 24;
    y = drawSubjectRankTable(doc, { x: margin, y, width: pageWidth, subjects: data.subjects });
  }

  doc.end();
});

// Bordered "Overall Grade Distribution" table: one header row of grade letters, one row of
// counts. Zero-count grades are still shown (0) so the band set is visibly complete.
function drawDistributionTable(doc, { x, y, width, distribution }) {
  const entries = Object.entries(distribution);
  const colW = width / entries.length;
  const headerH = 18;
  const rowH = 18;

  doc.font("Helvetica-Bold").fontSize(9).fillColor(PDF_INK).text("Overall Grade Distribution", x, y);
  y += 16;

  doc.rect(x, y, width, headerH).fill(PDF_INK);
  doc.fillColor("#FFFFFF").fontSize(8).font("Helvetica-Bold");
  entries.forEach(([grade], i) => {
    doc.text(grade, x + i * colW, y + 5, { width: colW, align: "center" });
  });
  y += headerH;

  doc.rect(x, y, width, rowH).strokeColor(PDF_LINE).lineWidth(0.5).stroke();
  entries.forEach(([, count], i) => {
    if (i > 0) doc.moveTo(x + i * colW, y).lineTo(x + i * colW, y + rowH).strokeColor(PDF_LINE).lineWidth(0.5).stroke();
  });
  doc.fillColor(PDF_SLATE).fontSize(8).font("Helvetica");
  entries.forEach(([, count], i) => {
    doc.text(String(count), x + i * colW, y + 5, { width: colW, align: "center" });
  });
  return y + rowH;
}

// Bordered "Subject Mean & Rank" table, one row per subject, already sorted by rank
// (buildExamAnalysis sorts subjectStats by mean desc and assigns s.rank).
function drawSubjectRankTable(doc, { x, y, width, subjects }) {
  const colW = { rank: 40, subject: width - 40 - 80 - 70, code: 80, mean: 70 };
  const colX = { rank: x, subject: x + colW.rank, code: x + colW.rank + colW.subject, mean: x + colW.rank + colW.subject + colW.code };
  const headerH = 18;
  const rowH = 16;

  doc.font("Helvetica-Bold").fontSize(9).fillColor(PDF_INK).text("Subject Mean & Rank", x, y);
  y += 16;

  doc.rect(x, y, width, headerH).fill(PDF_INK);
  doc.fillColor("#FFFFFF").fontSize(8).font("Helvetica-Bold");
  doc.text("RANK", colX.rank + 4, y + 5, { width: colW.rank - 4 });
  doc.text("SUBJECT", colX.subject + 4, y + 5, { width: colW.subject - 4 });
  doc.text("CODE", colX.code + 4, y + 5, { width: colW.code - 4 });
  doc.text("MEAN %", colX.mean + 4, y + 5, { width: colW.mean - 4 });
  y += headerH;

  subjects.forEach((s) => {
    if (y > doc.page.height - 50) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.rect(x, y, width, rowH).strokeColor(PDF_LINE).lineWidth(0.5).stroke();
    [colX.subject, colX.code, colX.mean].forEach((lineX) => {
      doc.moveTo(lineX, y).lineTo(lineX, y + rowH).strokeColor(PDF_LINE).lineWidth(0.5).stroke();
    });
    doc.fillColor(PDF_SLATE).fontSize(8).font("Helvetica");
    doc.text(String(s.rank), colX.rank + 4, y + 4, { width: colW.rank - 4 });
    doc.text(s.subject, colX.subject + 4, y + 4, { width: colW.subject - 4 });
    doc.text(s.code || "—", colX.code + 4, y + 4, { width: colW.code - 4 });
    doc.text(`${s.mean}%`, colX.mean + 4, y + 4, { width: colW.mean - 4 });
    y += rowH;
  });

  return y;
}

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
    // Same fix as the merit list: headers must follow subjectColumns (fixed order), matching
    // each row's `subjects` array — not the mean-ranked `data.subjects`.
    data.subjectColumns.forEach((s, i) => {
      doc.text((s.code || s.name).toUpperCase(), col.subjectsStart + i * subjectColWidth, y + 6, { width: subjectColWidth - 2 });
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
