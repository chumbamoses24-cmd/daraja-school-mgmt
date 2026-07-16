require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const authRoutes = require("./routes/auth");
const studentRoutes = require("./routes/students");
const attendanceRoutes = require("./routes/attendance");
const gradeRoutes = require("./routes/grades");
const feeRoutes = require("./routes/fees");
const timetableRoutes = require("./routes/timetable");
const messageRoutes = require("./routes/messages");
const settingsRoutes = require("./routes/settings");

const app = express();

// In production, restrict CORS to the deployed frontend URL only.
// Locally (no FRONTEND_URL set), allow any origin for convenience.
const allowedOrigin = process.env.FRONTEND_URL;
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : {}));
app.use(express.json());
app.use(morgan("dev"));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/grades", gradeRoutes);
app.use("/api/fees", feeRoutes);
app.use("/api/timetable", timetableRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/settings", settingsRoutes);

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
