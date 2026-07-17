const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { classRoomId, teacherId } = req.query;
  const where = {};
  if (classRoomId) where.classRoomId = Number(classRoomId);
  if (teacherId) where.teacherId = Number(teacherId);

  const slots = await prisma.timetableSlot.findMany({
    where,
    include: {
      classRoom: { select: { name: true } },
      teacher: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
  res.json(slots);
});

const slotSchema = z.object({
  classRoomId: z.number(),
  subjectId: z.number().optional(),
  teacherId: z.number().optional(),
  dayOfWeek: z.number().min(1).max(7),
  startTime: z.string(),
  endTime: z.string(),
  label: z.string().optional(),
});

router.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = slotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await prisma.timetableSlot.create({ data: parsed.data }));
});

router.put("/:id", requireRole("ADMIN"), async (req, res) => {
  const parsed = slotSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await prisma.timetableSlot.update({ where: { id: Number(req.params.id) }, data: parsed.data }));
});

router.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  await prisma.timetableSlot.delete({ where: { id: Number(req.params.id) } });
  res.status(204).end();
});

module.exports = router;
