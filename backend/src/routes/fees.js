const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { byAdmissionNo } = require("../lib/sort");

const router = express.Router();
// Fees are strictly admin business — teachers and parents get a 403 on every fee route.
router.use(requireAuth, requireRole("ADMIN"));

function statusFor(amountPaid, amountDue) {
  return amountPaid >= amountDue ? "PAID" : amountPaid > 0 ? "PARTIAL" : "UNPAID";
}

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

// Edit a fee structure (fixes a wrong amount, term, year or description). With
// updateInvoices: true, the already-generated invoices for that class/term/year are corrected too
// (amount due is reset to the new amount and the status recalculated against what's been paid).
router.put("/structures/:id", async (req, res) => {
  const schema = z.object({
    term: z.number().int().min(1).max(3).optional(),
    year: z.number().int().optional(),
    amount: z.number().min(0).optional(),
    description: z.string().nullable().optional(),
    updateInvoices: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const id = Number(req.params.id);
  const existing = await prisma.feeStructure.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Fee structure not found" });

  const { updateInvoices, ...data } = parsed.data;
  const structure = await prisma.feeStructure.update({ where: { id }, data });

  let invoicesUpdated = 0;
  if (updateInvoices) {
    const students = await prisma.student.findMany({ where: { classRoomId: existing.classRoomId }, select: { id: true } });
    const invoices = await prisma.invoice.findMany({
      where: { studentId: { in: students.map((s) => s.id) }, term: existing.term, year: existing.year },
    });
    await prisma.$transaction(
      invoices.map((inv) =>
        prisma.invoice.update({
          where: { id: inv.id },
          data: { amountDue: structure.amount, term: structure.term, year: structure.year, status: statusFor(inv.amountPaid, structure.amount) },
        })
      )
    );
    invoicesUpdated = invoices.length;
  }
  res.json({ structure, invoicesUpdated });
});

// ---- Invoices ----
router.get("/invoices", async (req, res) => {
  const { studentId } = req.query;
  const where = studentId ? { studentId: Number(studentId) } : {};
  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      student: {
        select: {
          firstName: true,
          lastName: true,
          admissionNo: true,
          // The Fees page groups invoices Level -> Stream -> students, so it needs each student's class.
          classRoom: { select: { id: true, name: true, level: true, stream: true } },
        },
      },
      payments: true,
    },
  });
  // Numeric admission-number order (72, 73, ... 102), newest term first for the same student.
  invoices.sort((a, b) => byAdmissionNo(a.student, b.student) || b.year - a.year || b.term - a.term || b.id - a.id);
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

// Edit an invoice — correct the amount invoiced (and optionally term/year) after a mistake. The
// status is recalculated against what has already been paid; recorded payments are never touched.
router.put("/invoices/:id", async (req, res) => {
  const schema = z.object({
    amountDue: z.number().min(0).optional(),
    term: z.number().int().min(1).max(3).optional(),
    year: z.number().int().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const id = Number(req.params.id);
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });

  const amountDue = parsed.data.amountDue ?? invoice.amountDue;
  const updated = await prisma.invoice.update({
    where: { id },
    data: { ...parsed.data, status: statusFor(invoice.amountPaid, amountDue) },
  });
  res.json(updated);
});

// Generate invoices for every student in a class from a fee structure
router.post("/invoices/generate", requireRole("ADMIN"), async (req, res) => {
  const schema = z.object({ feeStructureId: z.number() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const fs = await prisma.feeStructure.findUnique({ where: { id: parsed.data.feeStructureId } });
  if (!fs) return res.status(404).json({ error: "Fee structure not found" });

  const students = await prisma.student.findMany({ where: { classRoomId: fs.classRoomId } });
  // Don't double-invoice: skip students who already have an invoice for this term/year.
  const already = await prisma.invoice.findMany({
    where: { studentId: { in: students.map((s) => s.id) }, term: fs.term, year: fs.year },
    select: { studentId: true },
  });
  const invoiced = new Set(already.map((i) => i.studentId));
  const toCreate = students.filter((s) => !invoiced.has(s.id));
  await prisma.invoice.createMany({
    data: toCreate.map((s) => ({ studentId: s.id, term: fs.term, year: fs.year, amountDue: fs.amount })),
  });
  res.status(201).json({ created: toCreate.length, skipped: students.length - toCreate.length });
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
  const status = statusFor(newPaid, invoice.amountDue);
  await prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaid: newPaid, status } });

  res.status(201).json(payment);
});

module.exports = router;
