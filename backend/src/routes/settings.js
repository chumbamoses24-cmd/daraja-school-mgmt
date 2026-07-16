const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Ensures a settings row always exists, creating a default one on first access.
async function getOrCreateSettings() {
  let settings = await prisma.schoolSettings.findFirst();
  if (!settings) {
    settings = await prisma.schoolSettings.create({ data: {} });
  }
  return settings;
}

// Public — the login screen needs the school name before anyone is authenticated.
router.get("/", async (req, res) => {
  const settings = await getOrCreateSettings();
  res.json(settings);
});

const updateSchema = z.object({
  schoolName: z.string().min(1).max(100),
});

router.put("/", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const settings = await getOrCreateSettings();
  const updated = await prisma.schoolSettings.update({
    where: { id: settings.id },
    data: parsed.data,
  });
  res.json(updated);
});

module.exports = router;
