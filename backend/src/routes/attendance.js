const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Mark attendance for a whole class on a given date (bulk upsert)
const bulkSchema = z.object({
  classRoomId: z.number(),
  date: z.string(), // ISO date
  records: z.array(
    z.object({
      studentId: z.number(),
      status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
    })
  ),
});

router.post("/", requireRole("ADMIN", "TEACHER"), async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { date, records } = parsed.data;
  const day = new Date(date);

  const results = await Promise.all(
    records.map((r) =>
      prisma.attendance.upsert({
        where: { studentId_date: { studentId: r.studentId, date: day } },
        update: { status: r.status, markedById: req.user.id },
        create: { studentId: r.studentId, date: day, status: r.status, markedById: req.user.id },
      })
    )
  );
  res.status(201).json(results);
});

router.get("/", async (req, res) => {
  const { studentId, classRoomId, date, from, to } = req.query;
  const where = {};

  if (req.user.role === "PARENT") {
    const children = await prisma.student.findMany({ where: { parentId: req.user.id }, select: { id: true } });
    where.studentId = { in: children.map((c) => c.id) };
  } else if (studentId) {
    where.studentId = Number(studentId);
  }

  if (classRoomId) where.student = { classRoomId: Number(classRoomId) };
  if (date) where.date = new Date(date);
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }

  const records = await prisma.attendance.findMany({
    where,
    include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
    orderBy: { date: "desc" },
  });
  res.json(records);
});

// Quick summary: attendance rate per student over a date range
router.get("/summary/:studentId", async (req, res) => {
  const studentId = Number(req.params.studentId);
  const records = await prisma.attendance.findMany({ where: { studentId } });
  const total = records.length;
  const present = records.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
  res.json({
    studentId,
    total,
    present,
    absentRate: total ? Number((((total - present) / total) * 100).toFixed(1)) : 0,
    presentRate: total ? Number(((present / total) * 100).toFixed(1)) : 0,
  });
});

module.exports = router;
