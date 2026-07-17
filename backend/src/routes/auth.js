const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const loginSchema = z.object({
  identifier: z.string().min(1), // email or phone
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your email/phone and password" });

  const { identifier, password } = parsed.data;
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { phone: identifier }] },
  });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { id: user.id, role: user.role, email: user.email, firstName: user.firstName, lastName: user.lastName },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      mustChangePassword: user.mustChangePassword,
    },
  });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, role: true, firstName: true, lastName: true, phone: true, mustChangePassword: true },
  });
  res.json(user);
});

const updateProfileSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
});

// Self-service profile edit (name, phone, email). Role is not editable here.
router.put("/me", requireAuth, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = { ...parsed.data };
  if (data.email === "") data.email = null;

  if (data.email) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing && existing.id !== req.user.id) return res.status(409).json({ error: "Email already in use" });
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    select: { id: true, email: true, role: true, firstName: true, lastName: true, phone: true, mustChangePassword: true },
  });
  res.json(user);
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

// Self-service password change — also clears the forced-change flag
router.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const valid = await bcrypt.compare(parsed.data.currentPassword, user.password);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

  const hashed = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed, mustChangePassword: false },
  });
  res.json({ ok: true });
});

const createUserSchema = z.object({
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(1, "Phone number is required"),
  password: z.string().min(6),
  role: z.enum(["ADMIN", "TEACHER", "PARENT"]),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

// Only admins can create new staff/parent accounts.
// Phone is the required identifier; email is optional and can be added later.
// New accounts are created with a temporary password and must change it on first login.
router.post("/users", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { phone, password, role, firstName, lastName } = parsed.data;
  const email = parsed.data.email === "" ? null : parsed.data.email;

  const existingPhone = await prisma.user.findUnique({ where: { phone } });
  if (existingPhone) return res.status(409).json({ error: "Phone number already in use" });
  if (email) {
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) return res.status(409).json({ error: "Email already in use" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, phone, password: hashed, role, firstName, lastName, mustChangePassword: true },
  });
  res.status(201).json({ id: user.id, email: user.email, phone: user.phone, role: user.role });
});

router.get("/users", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { role } = req.query;
  const users = await prisma.user.findMany({
    where: role ? { role } : undefined,
    select: { id: true, email: true, role: true, firstName: true, lastName: true, phone: true, mustChangePassword: true },
  });
  res.json(users);
});

const adminEditUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal("")),
  role: z.enum(["ADMIN", "TEACHER", "PARENT"]).optional(),
});

// Admin editing another user's details — e.g. filling in an email that was skipped at creation,
// correcting a phone number, or changing role.
router.put("/users/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const userId = Number(req.params.id);
  const parsed = adminEditUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = { ...parsed.data };
  if (data.email === "") data.email = null;

  if (data.email) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing && existing.id !== userId) return res.status(409).json({ error: "Email already in use" });
  }
  if (data.phone) {
    const existing = await prisma.user.findUnique({ where: { phone: data.phone } });
    if (existing && existing.id !== userId) return res.status(409).json({ error: "Phone number already in use" });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, email: true, role: true, firstName: true, lastName: true, phone: true, mustChangePassword: true },
  });
  res.json(user);
});

// Deleting a user unlinks them from records that can survive without them (homeroom class,
// timetable slots, attendance marks, and their children as a parent), and removes records that
// only make sense tied to them (their subject-teaching assignments and messages).
router.delete("/users/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const userId = Number(req.params.id);
  if (userId === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account while logged in as it." }); 
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  await prisma.$transaction([
    prisma.classRoom.updateMany({ where: { teacherId: userId }, data: { teacherId: null } }),
    prisma.timetableSlot.updateMany({ where: { teacherId: userId }, data: { teacherId: null } }),
    prisma.attendance.updateMany({ where: { markedById: userId }, data: { markedById: null } }),
    prisma.student.updateMany({ where: { parentId: userId }, data: { parentId: null } }),
    prisma.classSubject.deleteMany({ where: { teacherId: userId } }),
    prisma.message.deleteMany({ where: { OR: [{ senderId: userId }, { recipientId: userId }] } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  res.status(204).end();
});

module.exports = router;
