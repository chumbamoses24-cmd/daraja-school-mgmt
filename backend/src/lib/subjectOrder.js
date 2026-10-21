// Fixed display order for subjects in exam analysis, merit lists, and report cards — matches
// how Kabiemit Junior School lays out its CBC subjects on paper. Anything not in this list
// (a subject added later, e.g. a new elective) falls back to alphabetical order after these.
const SUBJECT_ORDER = [
  "ENGLISH",
  "KISWAHILI",
  "MATHEMATICS",
  "INTEGRATED SCIENCE",
  "AGRICULTURE",
  "SOCIAL STUDIES",
  "CRE",
  "CREATIVE ARTS & SPORTS",
  "PRETECHNICAL STUDIES",
];

// Subject names are typed in by the admin, so the same subject can be spelled many ways
// ("Pre-Technical Studies", "PRE TECHNICAL", "Pretech", "Creative Arts and Sports"...). Everything
// that looks a subject up by name (display order, comment bank) goes through this one function
// so a spelling difference can never make a subject silently fall out of its slot or comment.
// Returns the canonical SUBJECT_ORDER name, or null if the subject isn't a recognised one.
function canonicalSubject(name) {
  const raw = String(name || "").toUpperCase().replace(/&/g, " AND ");
  const compact = raw.replace(/[^A-Z0-9]/g, "");
  if (!compact) return null;
  if (/PRE?TECH/.test(compact) || compact === "TECHNICAL" || compact.startsWith("TECHNICAL")) return "PRETECHNICAL STUDIES";
  if (compact.startsWith("ENG")) return "ENGLISH";
  if (compact.startsWith("KISW")) return "KISWAHILI";
  if (compact.startsWith("MATH")) return "MATHEMATICS";
  if (compact.includes("SCIENCE") || compact === "SCI") return "INTEGRATED SCIENCE";
  if (compact.startsWith("AGRI")) return "AGRICULTURE";
  if (compact.startsWith("SOCIAL") || compact === "SST") return "SOCIAL STUDIES";
  if (compact === "CRE" || compact.startsWith("CHRISTIAN") || compact.includes("RELIGIOUS")) return "CRE";
  if (compact.startsWith("CREATIVE") || compact.includes("ARTS") || compact === "CAS") return "CREATIVE ARTS & SPORTS";
  return null;
}

function subjectRank(name) {
  const canon = canonicalSubject(name);
  const idx = canon ? SUBJECT_ORDER.indexOf(canon) : -1;
  return idx === -1 ? SUBJECT_ORDER.length : idx;
}

// Sorts an array of items by a given subject-name accessor, following SUBJECT_ORDER first,
// then alphabetically for anything not in that list (and among any ties).
function sortBySubjectOrder(list, nameOf = (x) => x) {
  return [...list].sort((a, b) => {
    const rankDiff = subjectRank(nameOf(a)) - subjectRank(nameOf(b));
    if (rankDiff !== 0) return rankDiff;
    return String(nameOf(a)).localeCompare(String(nameOf(b)));
  });
}

module.exports = { SUBJECT_ORDER, canonicalSubject, subjectRank, sortBySubjectOrder };
