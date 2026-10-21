const prisma = require("./prisma");
const { canonicalSubject } = require("./subjectOrder");

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

// Auto-generated head teacher's remark — same point thresholds as the class teacher's comment,
// but a shorter, coarser phrase. A total of 0 (or no grades recorded) is left blank.
const HEAD_TEACHER_COMMENT_BANDS = [
  { min: 68, comment: "Excellent performance!" },
  { min: 60, comment: "Excellent performance!" },
  { min: 52, comment: "Satisfactory. Work towards exceeding expectations" },
  { min: 43, comment: "Satisfactory. Work towards exceeding expectations" },
  { min: 34, comment: "Can do better!" },
  { min: 25, comment: "Can do better!" },
  { min: 16, comment: "Aim higher!" },
  { min: 9, comment: "Aim higher!" },
];

function headTeacherComment(totalPoints) {
  if (totalPoints == null || totalPoints === 0) return "";
  const band = HEAD_TEACHER_COMMENT_BANDS.find((b) => totalPoints >= b.min);
  return band ? band.comment : "";
}

// Overall "Level" for the merit list / report form — CBC-style band (EE1..BE2) derived from
// a student's totalPoints (sum of per-subject grade points), using the same thresholds Moses
// specified. Blank at 0/no grades, same convention as headTeacherComment.
const LEVEL_BANDS = [
  { min: 68, level: "EE1" },
  { min: 60, level: "EE2" },
  { min: 52, level: "ME1" },
  { min: 43, level: "ME2" },
  { min: 34, level: "AE1" },
  { min: 25, level: "AE2" },
  { min: 16, level: "BE1" },
  { min: 9, level: "BE2" },
];

function levelForPoints(totalPoints) {
  if (totalPoints == null || totalPoints === 0) return "";
  const band = LEVEL_BANDS.find((b) => totalPoints >= b.min);
  return band ? band.level : "";
}

// CBC national-assessment performance level (EE1..BE2) for a single subject, banded on that
// subject's own percentage score (not totalPoints like levelForPoints, which is cross-subject).
// Thresholds match the standard CBC bands Moses supplied for the subject comment tables below.
const CBC_LEVEL_BANDS = [
  { min: 90, level: "EE1" },
  { min: 75, level: "EE2" },
  { min: 58, level: "ME1" },
  { min: 41, level: "ME2" },
  { min: 31, level: "AE1" },
  { min: 21, level: "AE2" },
  { min: 11, level: "BE1" },
  { min: 1, level: "BE2" },
];

function cbcLevelForPercent(percent) {
  if (percent == null) return null;
  const band = CBC_LEVEL_BANDS.find((b) => percent >= b.min);
  return band ? band.level : null;
}

// Auto-generated per-subject teacher's comment for the report form's BREAKDOWN table, banded
// on that subject's own CBC performance level (derived from its percentage score). Keyed by
// the subject names in SUBJECT_ORDER (subjectOrder.js) — Kabiemit's actual CBC subject list.
const SUBJECT_COMMENTS = {
  ENGLISH: {
    EE1: "Outstanding command of English. Reads fluently, writes creatively and speaks with confidence. Keep it up.",
    EE2: "Very good grasp of grammar, comprehension and composition. Aim for even more creativity in your writing.",
    ME1: "Good understanding of language skills. Read more story books to widen your vocabulary.",
    ME2: "Meets the basic expectations. More practice in grammar and composition will improve your performance.",
    AE1: "Shows some understanding but makes frequent spelling and sentence errors. Practise reading and writing daily.",
    AE2: "Struggles with comprehension and written work. Needs guided reading and extra support.",
    BE1: "Has difficulty with basic reading and writing. Needs close supervision and remedial help.",
    BE2: "Yet to acquire the foundational English skills. Needs intensive remedial support and daily reading practice.",
  },
  KISWAHILI: {
    EE1: "Umahiri wa hali ya juu katika Kiswahili. Unasoma, unaandika na kuzungumza kwa ufasaha. Endelea hivyo.",
    EE2: "Umefanya vizuri sana katika sarufi, ufahamu na insha. Jitahidi kuongeza ubunifu wako.",
    ME1: "Uelewa mzuri wa stadi za lugha. Soma vitabu vingi zaidi ili kuongeza msamiati.",
    ME2: "Umefikia kiwango cha msingi. Fanya mazoezi zaidi ya sarufi na uandishi ili kuimarika.",
    AE1: "Una uelewa wa kiasi lakini unakosea tahajia na sentensi. Fanya mazoezi ya kusoma na kuandika kila siku.",
    AE2: "Unapata shida katika ufahamu na uandishi. Unahitaji kusaidiwa kusoma na mazoezi ya ziada.",
    BE1: "Una ugumu katika kusoma na kuandika msingi. Unahitaji usimamizi wa karibu na msaada wa ziada.",
    BE2: "Bado hujapata stadi za msingi za Kiswahili. Unahitaji msaada wa kina na mazoezi ya kila siku.",
  },
  MATHEMATICS: {
    EE1: "Exceptional mathematical reasoning. Solves complex problems accurately and quickly. Excellent work.",
    EE2: "Very good understanding of concepts and applies them well. Attempt more challenging problems to reach the top.",
    ME1: "Good grasp of concepts. Show all your working and practise more word problems.",
    ME2: "Meets the basic expectations. Regular practice of operations and formulas will help you improve.",
    AE1: "Understands some concepts but makes frequent computation errors. Revise the basics and practise daily.",
    AE2: "Struggles with most concepts. Needs extra guidance and practice, starting with the basic operations.",
    BE1: "Has difficulty with basic number work. Requires remedial lessons and close supervision.",
    BE2: "Yet to master the foundational numeracy skills. Needs intensive one-on-one support and regular drills.",
  },
  "INTEGRATED SCIENCE": {
    EE1: "Excellent scientific understanding. Investigates, explains and applies concepts with great skill.",
    EE2: "Very good grasp of scientific concepts and practical work. Keep asking questions and exploring.",
    ME1: "Good understanding of science concepts. Be more detailed when explaining your observations.",
    ME2: "Meets the basic expectations. Revise your notes regularly and take part more in practical activities.",
    AE1: "Shows partial understanding of concepts. Needs more revision and hands-on practice.",
    AE2: "Finds it hard to recall and apply scientific ideas. Needs extra support and guided revision.",
    BE1: "Has major gaps in understanding science concepts. Needs remedial support and close follow-up.",
    BE2: "Yet to grasp the basic science concepts. Needs intensive support and simple, repeated practical activities.",
  },
  AGRICULTURE: {
    EE1: "Excellent knowledge and skills in farming practices. A dedicated and hardworking learner.",
    EE2: "Very good understanding of agricultural concepts and practical skills. Keep up the good work.",
    ME1: "Good performance in theory and practical work. Take more initiative in the school garden.",
    ME2: "Meets the basic expectations. Be more active in practical lessons and revise key concepts.",
    AE1: "Shows some understanding but is inconsistent in practical work. Needs more effort and revision.",
    AE2: "Struggles with concepts and practical tasks. Needs guidance and more participation in garden activities.",
    BE1: "Has difficulty understanding basic farming concepts. Requires close supervision and extra support.",
    BE2: "Yet to acquire the basic agricultural knowledge and skills. Needs intensive guidance and hands-on practice.",
  },
  "SOCIAL STUDIES": {
    EE1: "Outstanding knowledge of social studies. Analyses issues well and expresses ideas clearly.",
    EE2: "Very good understanding of the content. Support your points with more examples.",
    ME1: "Good grasp of concepts. Read more widely and improve your map work.",
    ME2: "Meets the basic expectations. Revise regularly to improve recall and understanding.",
    AE1: "Understands some content but struggles to recall facts. Needs regular revision.",
    AE2: "Finds it hard to understand and recall content. Needs guided revision and extra support.",
    BE1: "Has significant gaps in the content. Requires remedial lessons and close follow-up.",
    BE2: "Yet to grasp the basic concepts. Needs intensive support using simple, repeated lessons.",
  },
  CRE: {
    EE1: "Excellent knowledge of Bible teachings and applies them well in daily life. A good role model.",
    EE2: "Very good understanding of Bible stories and values. Keep practising what you learn.",
    ME1: "Good grasp of Bible content. Memorise key verses and relate them to everyday life.",
    ME2: "Meets the basic expectations. Revise Bible stories regularly to improve your performance.",
    AE1: "Shows some knowledge but struggles to recall key lessons. Needs more reading and revision.",
    AE2: "Finds it difficult to understand and recall Bible teachings. Needs extra guidance.",
    BE1: "Has major gaps in Bible knowledge. Needs close support and regular revision.",
    BE2: "Yet to grasp the basic Bible teachings. Needs intensive support with simple, repeated lessons.",
  },
  "CREATIVE ARTS & SPORTS": {
    EE1: "Exceptional talent and creativity in arts and sports. Participates actively and sets an example for others.",
    EE2: "Very good skills and creativity. Keep developing your talent.",
    ME1: "Good participation and skills. More practice will help you excel.",
    ME2: "Meets the basic expectations. Be more consistent in practice and participation.",
    AE1: "Shows some skill but participates inconsistently. Needs more effort and practice.",
    AE2: "Struggles with the skills required. Needs encouragement and regular guided practice.",
    BE1: "Has difficulty performing the basic skills. Needs close guidance and encouragement to participate.",
    BE2: "Yet to acquire the basic skills. Needs intensive support and gentle encouragement to take part.",
  },
  "PRETECHNICAL STUDIES": {
    EE1: "Excellent technical skills and understanding. Designs, draws and builds with great accuracy.",
    EE2: "Very good grasp of concepts and practical skills. Keep using your creativity.",
    ME1: "Good understanding of concepts. Improve neatness and accuracy in drawings and projects.",
    ME2: "Meets the basic expectations. More practice in practical tasks will improve your results.",
    AE1: "Shows partial understanding and makes errors in practical work. Needs more practice and revision.",
    AE2: "Struggles with concepts and practical skills. Needs guided practice and extra support.",
    BE1: "Has difficulty with basic technical concepts and tools. Requires close supervision and remedial help.",
    BE2: "Yet to acquire the basic technical skills. Needs intensive, hands-on support.",
  },
};

// Fallback comment table (generic, not subject-specific) for any subject not covered above —
// e.g. an elective added later. Banded on the subject's own letter grade, same as before.
const SUBJECT_COMMENT_BY_GRADE = {
  A: "Excellent, keep it up!",
  "A-": "Excellent, keep it up!",
  "B+": "Very good work",
  B: "Very good work",
  "B-": "Good, aim higher",
  "C+": "Good, aim higher",
  C: "Satisfactory, needs practice",
  "C-": "Satisfactory, needs practice",
  "D+": "Below average, needs support",
  D: "Below average, needs support",
  "D-": "Weak, needs close attention",
  E: "Weak, needs close attention",
};

// Per-subject, CBC-level-banded comment for the report form's breakdown table. Looks up the
// subject by name (matching SUBJECT_ORDER) and the student's percentage in that subject; falls
// back to the generic letter-grade table for subjects with no dedicated comment bank.
function subjectComment(subjectName, percent, grade) {
  // Match the subject by its canonical name so spelling variants ("Pre-Technical Studies",
  // "PRE TECHNICAL", "Creative Arts and Sports"...) still find their comment bank.
  const key = canonicalSubject(subjectName) || String(subjectName || "").trim().toUpperCase();
  const bank = SUBJECT_COMMENTS[key];
  const level = cbcLevelForPercent(percent);
  if (bank && level && bank[level]) return bank[level];
  return SUBJECT_COMMENT_BY_GRADE[grade] || "";
}

module.exports = {
  getGradingSystem,
  gradeForPercent,
  DEFAULT_BANDS,
  classTeacherComment,
  headTeacherComment,
  levelForPoints,
  cbcLevelForPercent,
  subjectComment,
  LEVEL_ORDER: LEVEL_BANDS.map((b) => b.level),
};
