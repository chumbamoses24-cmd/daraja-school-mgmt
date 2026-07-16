const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Inbox: messages received by the current user
router.get("/inbox", async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { recipientId: req.user.id },
    include: { sender: { select: { firstName: true, lastName: true, role: true } } },
    orderBy: { sentAt: "desc" },
  });
  res.json(messages);
});

// Sent: messages the current user has sent
router.get("/sent", async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { senderId: req.user.id },
    include: { recipient: { select: { firstName: true, lastName: true, role: true } } },
    orderBy: { sentAt: "desc" },
  });
  res.json(messages);
});

const sendSchema = z.object({
  recipientId: z.number(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

router.post("/", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const message = await prisma.message.create({
    data: { ...parsed.data, senderId: req.user.id },
  });
  res.status(201).json(message);
});

router.post("/:id/read", async (req, res) => {
  const message = await prisma.message.findUnique({ where: { id: Number(req.params.id) } });
  if (!message || message.recipientId !== req.user.id) return res.status(404).json({ error: "Message not found" });
  const updated = await prisma.message.update({ where: { id: message.id }, data: { readAt: new Date() } });
  res.json(updated);
});

module.exports = router;
