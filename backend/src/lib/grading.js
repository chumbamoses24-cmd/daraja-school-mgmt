const prisma = require("./prisma");

// Default KCSE-style 12-point grading scale, used only if the school hasn't configured one yet.
const DEFAULT_BANDS = [
  { grade: "A", minPercent: 80, maxPercent: 100, points: 12, order: 1 },
  { grade: "A-", minPercent: 75, maxPercent: 79.99, points: 11, order: 2 },
  { grade: "B+", minPercent: 70, maxPercent: 74.99, points: 10, order: 3 },
  { grade: "B", minPercent: 65, maxPercent: 69.99, points: 9, order: 4 },
  { grade: "B-", minPercent: 60, maxPercent: 64.99, points: 8, order: 5 },
  { grade: "C+", minPercent: 55, maxPercent: 59.99, points: 7, order: 6 },
  { grade: "C", minPercent: 50, maxPercent: 54.99, points: 6, order: 7 },
  { grade: "C-", minPercent: 45, maxPercent: 49.99, points: 5, order: 8 },
  { grade: "D+", minPercent: 40, maxPercent: 44.99, points: 4, order: 9 },
  { grade: "D", minPercent: 35, maxPercent: 39.99, points: 3, order: 10 },
  { grade: "D-", minPercent: 30, maxPercent: 34.99, points: 2, order: 11 },
  { grade: "E", minPercent: 0, maxPercent: 29.99, points: 1, order: 12 },
];

// Returns the school's grading bands, seeding the default scale on first use.
async function getGradingSystem() {
  let bands = await prisma.gradeBand.findMany({ orderBy: { order: "asc" } });
  if (bands.length === 0) {
    await prisma.gradeBand.createMany({ data: DEFAULT_BANDS });
    bands = await prisma.gradeBand.findMany({ orderBy: { order: "asc" } });
  }
  return bands;
}

// Given a percentage and a (pre-fetched) list of bands, returns { grade, points }.
// Falls back to the lowest band's grade if the percentage doesn't match any band.
function gradeForPercent(percent, bands) {
  const match = bands.find((b) => percent >= b.minPercent && percent <= b.maxPercent);
  if (match) return { grade: match.grade, points: match.points };
  const lowest = bands[bands.length - 1];
  return lowest ? { grade: lowest.grade, points: lowest.points } : { grade: "-", points: 0 };
}

// Auto-generated class teacher's remark, banded on the student's total points across all
// subjects (not mean points) — replaces the handwritten remarks line on the report card.
// Bands are in descending order; the first one the total points clears wins.
const COMMENT_BANDS = [
  { min: 68, comment: "Consistently excels beyond expectations; a model of excellence and inspiration to peers, Good work!" },
  { min: 60, comment: "Demonstrates creativity, initiative, and strong mastery of skills" },
  { min: 52, comment: "Works well with independence. Has potential to improve" },
  { min: 43, comment: "Shows reliable effort and understanding; can do better!" },
  { min: 34, comment: "Demonstrates growing independence in learning; work to meet expectation" },
  { min: 25, comment: "Beginning to grasp key ideas with support; steady practice will strengthen confidence and improve performance" },
  { min: 16, comment: "Shows limited progress; continued effort and reinforcement are needed" },
  { min: 9, comment: "Put more effort; requires close guidance and consistent support." },
];

function classTeacherComment(totalPoints) {
  if (totalPoints == null) return "";
  const band = COMMENT_BANDS.find((b) => totalPoints >= b.min);
  return band ? band.comment : "";
}

module.exports = { getGradingSystem, gradeForPercent, DEFAULT_BANDS, classTeacherComment };
