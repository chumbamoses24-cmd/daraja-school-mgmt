// Admission numbers are stored as strings (they may carry a school prefix, e.g. "KJS-102"),
// so a plain string sort puts "102" before "72" and "73". This extracts the numeric portion
// and sorts on that instead, falling back to a plain string compare for non-numeric formats.
function admissionSortKey(admissionNo) {
  const match = String(admissionNo || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function byAdmissionNo(a, b) {
  const aNo = typeof a === "string" ? a : a.admissionNo;
  const bNo = typeof b === "string" ? b : b.admissionNo;
  const aKey = admissionSortKey(aNo);
  const bKey = admissionSortKey(bNo);
  if (aKey != null && bKey != null && aKey !== bKey) return aKey - bKey;
  if (aKey != null && bKey == null) return -1;
  if (aKey == null && bKey != null) return 1;
  return String(aNo).localeCompare(String(bNo));
}

// Sorts an array of students (or anything with an admissionNo field) in place-safe fashion.
function sortByAdmissionNo(list) {
  return [...list].sort(byAdmissionNo);
}

module.exports = { admissionSortKey, byAdmissionNo, sortByAdmissionNo };
