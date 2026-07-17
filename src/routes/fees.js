const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// ---- Fee structures ----
router.get("/structures", async (req, res) => {
  res.json(await prisma.feeStructure.findMany({ include: { classRoom: { select: { name: true } } } }));
});

router.post("/structures", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({
    classRoomId: z.number(),
    term: z.number(),
    year: z.number(),
    amount: z.number(),
    description: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await prisma.feeStructure.create({ data: parsed.data }));
});

// ---- Invoices ----
router.get("/invoices", async (req, res) => {
  const { studentId } = req.query;
  const where = {};
  if (req.user.role === "PARENT") {
    const children = await prisma.student.findMany({ where: { parentId: req.user.id }, select: { id: true } });
    where.studentId = { in: children.map((c) => c.id) };
  } else if (studentId) {
    where.studentId = Number(studentId);
  }
  const invoices = await prisma.invoice.findMany({
    where,
    include: { student: { select: { firstName: true, lastName: true, admissionNo: true } }, payments: true },
    orderBy: { id: "desc" },
  });
  res.json(invoices);
});

router.post("/invoices", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({
    studentId: z.number(),
    term: z.number(),
    year: z.number(),
    amountDue: z.number(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const invoice = await prisma.invoice.create({ data: parsed.data });
  res.status(201).json(invoice);
});

// Generate invoices for every student in a class from a fee structure
router.post("/invoices/generate", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({ feeStructureId: z.number() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const fs = await prisma.feeStructure.findUnique({ where: { id: parsed.data.feeStructureId } });
  if (!fs) return res.status(404).json({ error: "Fee structure not found" });

  const students = await prisma.student.findMany({ where: { classRoomId: fs.classRoomId } });
  const invoices = await Promise.all(
    students.map((s) =>
      prisma.invoice.create({
        data: { studentId: s.id, term: fs.term, year: fs.year, amountDue: fs.amount },
      })
    )
  );
  res.status(201).json({ created: invoices.length });
});

// ---- Payments ----
router.post("/payments", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({
    invoiceId: z.number(),
    amount: z.number(),
    method: z.string().min(1),
    reference: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const invoice = await prisma.invoice.findUnique({ where: { id: parsed.data.invoiceId } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });

  const payment = await prisma.payment.create({ data: parsed.data });
  const newPaid = invoice.amountPaid + parsed.data.amount;
  const status = newPaid >= invoice.amountDue ? "PAID" : newPaid > 0 ? "PARTIAL" : "UNPAID";
  await prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaid: newPaid, status } });

  res.status(201).json(payment);
});

module.exports = router;
