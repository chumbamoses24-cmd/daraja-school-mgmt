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

// Same normalization as grading.js's subjectComment() — strips everything but letters/digits so
// "Pre-Technical Studies" (admin-typed, with a hyphen) still matches "PRETECHNICAL STUDIES"
// here instead of silently falling to alphabetical-last.
const normalize = (name) => String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const NORMALIZED_ORDER = SUBJECT_ORDER.map(normalize);

function subjectRank(name) {
  const idx = NORMALIZED_ORDER.indexOf(normalize(name));
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

module.exports = { SUBJECT_ORDER, subjectRank, sortBySubjectOrder };
