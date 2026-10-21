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

// Delete a fee structure created by mistake. Invoices already generated from it are separate
// records and are kept, unless ?withInvoices=true — then this class's invoices for that term/year
// are removed too, but only the ones with no payments recorded (money is never silently deleted).
router.delete("/structures/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.feeStructure.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Fee structure not found" });

  let invoicesDeleted = 0;
  let invoicesKept = 0;
  if (req.query.withInvoices === "true") {
    const students = await prisma.student.findMany({ where: { classRoomId: existing.classRoomId }, select: { id: true } });
    const invoices = await prisma.invoice.findMany({
      where: { studentId: { in: students.map((s) => s.id) }, term: existing.term, year: existing.year },
      include: { _count: { select: { payments: true } } },
    });
    const removable = invoices.filter((i) => i._count.payments === 0 && i.amountPaid === 0).map((i) => i.id);
    invoicesKept = invoices.length - removable.length;
    if (removable.length) {
      const r = await prisma.invoice.deleteMany({ where: { id: { in: removable } } });
      invoicesDeleted = r.count;
    }
  }
  await prisma.feeStructure.delete({ where: { id } });
  res.json({ deleted: true, invoicesDeleted, invoicesKept });
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

// Delete an invoice created by mistake. If payments were already recorded against it, the caller
// must pass ?force=true (the UI asks for an extra confirmation) and those payments are removed with it.
router.delete("/invoices/:id", async (req, res) => {
  const id = Number(req.params.id);
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { _count: { select: { payments: true } } } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (invoice._count.payments > 0 && req.query.force !== "true") {
    return res.status(409).json({
      error: `This invoice has ${invoice._count.payments} payment(s) recorded. Deleting it will remove them too.`,
      hasPayments: true,
    });
  }
  await prisma.$transaction([
    prisma.payment.deleteMany({ where: { invoiceId: id } }),
    prisma.invoice.delete({ where: { id } }),
  ]);
  res.json({ deleted: true });
});

// Generate invoices from fee structures. Two ways to call it:
//  1) { feeStructureId }                      -> one class, one term (the original behaviour)
//  2) { year, terms: [1,2,3], classRoomId? }  -> any mix of terms for a year, for one class or (if
//     classRoomId is left out) every class that has a fee structure. Ticking all three terms invoices
//     the whole year; ticking only some (e.g. 2 and 3) invoices just those. Students who already
//     have an invoice for a given term/year are skipped, so it is safe to run again.
router.post("/invoices/generate", requireRole("ADMIN"), async (req, res) => {
  const schema = z.union([
    z.object({ feeStructureId: z.number() }),
    z.object({
      year: z.number().int(),
      terms: z.array(z.number().int().min(1).max(3)).min(1),
      classRoomId: z.number().int().optional(),
    }),
  ]);
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let structures;
  if ("feeStructureId" in parsed.data) {
    const one = await prisma.feeStructure.findUnique({ where: { id: parsed.data.feeStructureId } });
    if (!one) return res.status(404).json({ error: "Fee structure not found" });
    structures = [one];
  } else {
    const { year, terms, classRoomId } = parsed.data;
    structures = await prisma.feeStructure.findMany({
      where: { year, term: { in: terms }, ...(classRoomId ? { classRoomId } : {}) },
    });
    if (structures.length === 0) {
      return res.status(404).json({ error: `No fee structure found for ${year} term(s) ${terms.join(", ")}. Create the fee structure first.` });
    }
  }

  let created = 0;
  let skipped = 0;
  for (const fs of structures) {
    const students = await prisma.student.findMany({ where: { classRoomId: fs.classRoomId, status: "ACTIVE" } });
    const already = await prisma.invoice.findMany({
      where: { studentId: { in: students.map((s) => s.id) }, term: fs.term, year: fs.year },
      select: { studentId: true },
    });
    const invoiced = new Set(already.map((i) => i.studentId));
    const toCreate = students.filter((s) => !invoiced.has(s.id));
    if (toCreate.length) {
      await prisma.invoice.createMany({
        data: toCreate.map((s) => ({ studentId: s.id, term: fs.term, year: fs.year, amountDue: fs.amount })),
      });
    }
    created += toCreate.length;
    skipped += students.length - toCreate.length;
  }

  // Tell the admin which requested terms had no fee structure, so nothing is silently missed.
  let missingTerms = [];
  if (!("feeStructureId" in parsed.data)) {
    const have = new Set(structures.map((s) => s.term));
    missingTerms = parsed.data.terms.filter((t) => !have.has(t));
  }
  res.status(201).json({ created, skipped, structuresUsed: structures.length, missingTerms });
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
