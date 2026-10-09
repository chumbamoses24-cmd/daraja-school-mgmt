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

function subjectRank(name) {
  const idx = SUBJECT_ORDER.indexOf(String(name || "").trim().toUpperCase());
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
