import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

export default function Grades() {
  const { user } = useAuth();
  const canEnter = user.role === "ADMIN" || user.role === "TEACHER";
  const isAdmin = user.role === "ADMIN";

  const [classRooms, setClassRooms] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [exams, setExams] = useState([]);
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [classSubjects, setClassSubjects] = useState([]);

  const [classRoomId, setClassRoomId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [examId, setExamId] = useState("");
  const [scores, setScores] = useState({});
  const [maxScore, setMaxScore] = useState("100");
  const [saved, setSaved] = useState(false);

  const [reportStudentId, setReportStudentId] = useState("");
  const [reportExamId, setReportExamId] = useState("");
  const [reportCard, setReportCard] = useState(null);
  const [printMode, setPrintMode] = useState("individual"); // "individual" | "class"

  const [showExamForm, setShowExamForm] = useState(false);
  const [examForm, setExamForm] = useState({ name: "", term: "1", year: String(new Date().getFullYear()), classRoomIds: [] });
  const [examError, setExamError] = useState("");
  const [editingExamId, setEditingExamId] = useState(null);
  const [examEditForm, setExamEditForm] = useState({ name: "", term: "1", year: "" });
  const [examEditError, setExamEditError] = useState("");

  const [showSubjectForm, setShowSubjectForm] = useState(false);
  const [subjectForm, setSubjectForm] = useState({ name: "", code: "" });
  const [editingSubjectId, setEditingSubjectId] = useState(null);
  const [subjectError, setSubjectError] = useState("");

  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignForm, setAssignForm] = useState({ subjectId: "", teacherId: "" });
  const [assignError, setAssignError] = useState("");

  useEffect(() => {
    client.get("/students/classrooms").then((r) => {
      setClassRooms(r.data);
      if (r.data.length) setClassRoomId(String(r.data[0].id));
    });
    refreshSubjects();
    client.get("/students").then((r) => setStudents(r.data));
    if (isAdmin) client.get("/auth/users?role=TEACHER").then((r) => setTeachers(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshExams();
    refreshClassSubjects();
  }, [classRoomId]);

  useEffect(() => {
    if (canEnter && classRoomId) client.get(`/students?classRoomId=${classRoomId}`).then((r) => setStudents(r.data));
  }, [canEnter, classRoomId]);

  function refreshExams() {
    if (classRoomId) client.get(`/grades/exams?classRoomId=${classRoomId}`).then((r) => setExams(r.data));
  }

  function refreshSubjects() {
    client.get("/grades/subjects").then((r) => setSubjects(r.data));
  }

  function refreshClassSubjects() {
    if (classRoomId) client.get(`/grades/class-subjects?classRoomId=${classRoomId}`).then((r) => setClassSubjects(r.data));
  }

  async function handleCreateSubject(e) {
    e.preventDefault();
    setSubjectError("");
    try {
      if (editingSubjectId) {
        await client.put(`/grades/subjects/${editingSubjectId}`, subjectForm);
      } else {
        await client.post("/grades/subjects", subjectForm);
      }
      setSubjectForm({ name: "", code: "" });
      setEditingSubjectId(null);
      setShowSubjectForm(false);
      refreshSubjects();
    } catch (err) {
      setSubjectError(err.response?.data?.error?.formErrors?.join(", ") || "Could not save subject");
    }
  }

  function handleEditSubject(subject) {
    setEditingSubjectId(subject.id);
    setSubjectForm({ name: subject.name, code: subject.code });
    setShowSubjectForm(true);
  }

  async function handleAssignTeacher(e) {
    e.preventDefault();
    setAssignError("");
    try {
      await client.post("/grades/class-subjects", {
        classRoomId: Number(classRoomId),
        subjectId: Number(assignForm.subjectId),
        teacherId: Number(assignForm.teacherId),
      });
      setAssignForm({ subjectId: "", teacherId: "" });
      setShowAssignForm(false);
      refreshClassSubjects();
    } catch (err) {
      setAssignError(err.response?.data?.error?.formErrors?.join(", ") || "Could not save assignment");
    }
  }

  async function handleRemoveAssignment(assignmentId) {
    if (!window.confirm("Remove this teacher's assignment to this subject?")) return;
    await client.delete(`/grades/class-subjects/${assignmentId}`);
    refreshClassSubjects();
  }

  // Teachers see all subjects for a class they're the homeroom teacher of; otherwise only their assigned subjects.
  const currentClass = classRooms.find((c) => String(c.id) === classRoomId);
  const isHomeroomTeacher = currentClass?.teacher?.id === user.id;
  const availableSubjects =
    isAdmin || isHomeroomTeacher
      ? subjects
      : subjects.filter((s) => classSubjects.some((cs) => cs.subject.id === s.id && cs.teacher.id === user.id));

  function toggleExamClass(id) {
    setExamForm((f) => ({
      ...f,
      classRoomIds: f.classRoomIds.includes(id) ? f.classRoomIds.filter((c) => c !== id) : [...f.classRoomIds, id],
    }));
  }

  async function handleCreateExam(e) {
    e.preventDefault();
    setExamError("");
    if (examForm.classRoomIds.length === 0) {
      setExamError("Select at least one class to sit this exam");
      return;
    }
    try {
      const created = await Promise.all(
        examForm.classRoomIds.map((crId) =>
          client.post("/grades/exams", {
            name: examForm.name,
            term: Number(examForm.term),
            year: Number(examForm.year),
            classRoomId: Number(crId),
          })
        )
      );
      setExamForm({ name: "", term: "1", year: String(new Date().getFullYear()), classRoomIds: [] });
      setShowExamForm(false);
      refreshExams();
      // Select the exam that was created for the class currently being viewed, if any
      const matching = created.find((r) => String(r.data.classRoomId) === classRoomId);
      if (matching) setExamId(String(matching.data.id));
    } catch (err) {
      setExamError(err.response?.data?.error?.formErrors?.join(", ") || "Could not create exam");
    }
  }

  function handleEditExam(exam) {
    setEditingExamId(exam.id);
    setExamEditForm({ name: exam.name, term: String(exam.term), year: String(exam.year) });
    setExamEditError("");
  }

  async function handleSaveExamEdit(e) {
    e.preventDefault();
    setExamEditError("");
    try {
      await client.put(`/grades/exams/${editingExamId}`, {
        name: examEditForm.name,
        term: Number(examEditForm.term),
        year: Number(examEditForm.year),
      });
      setEditingExamId(null);
      refreshExams();
    } catch (err) {
      setExamEditError(err.response?.data?.error?.formErrors?.join(", ") || "Could not save changes");
    }
  }

  async function handleDeleteExam(exam) {
    if (!window.confirm(`Delete "${exam.name}" (Term ${exam.term}, ${exam.year})? This also deletes all grades recorded for this exam. This cannot be undone.`)) return;
    try {
      await client.delete(`/grades/exams/${exam.id}`);
      refreshExams();
    } catch (err) {
      alert(err.response?.data?.error || "Could not delete exam");
    }
  }

  async function handleTogglePublish(exam) {
    const willPublish = !exam.published;
    if (willPublish && !window.confirm(`Publish "${exam.name}"? Parents will be able to see results for this exam once published.`)) return;
    try {
      await client.put(`/grades/exams/${exam.id}`, { published: willPublish });
      refreshExams();
    } catch (err) {
      alert(err.response?.data?.error || "Could not update publish status");
    }
  }

  const [excelError, setExcelError] = useState("");
  const [excelSummary, setExcelSummary] = useState("");

  async function handleSaveScores() {
    const records = Object.entries(scores).map(([studentId, score]) => ({
      studentId: Number(studentId),
      score: Number(score),
      maxScore: Number(maxScore) || 100,
    }));
    await client.post("/grades", { examId: Number(examId), subjectId: Number(subjectId), records });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // Reads an uploaded .xlsx with columns "Admission No" and "Score", matches students by admission
  // number, and fills the score entry table so the teacher can review before saving.
  async function handleExcelUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExcelError("");
    setExcelSummary("");
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);

      if (rows.length === 0) {
        setExcelError("That file appears to be empty.");
        return;
      }

      const findKey = (row, candidates) => Object.keys(row).find((k) => candidates.includes(k.trim().toLowerCase()));
      const admKey = findKey(rows[0], ["admission no", "admissionno", "adm no", "adm"]);
      const scoreKey = findKey(rows[0], ["score", "marks", "mark"]);

      if (!admKey || !scoreKey) {
        setExcelError('Could not find "Admission No" and "Score" columns in that file.');
        return;
      }

      const newScores = { ...scores };
      let matched = 0;
      let unmatched = [];
      rows.forEach((row) => {
        const admNo = String(row[admKey]).trim();
        const student = students.find((s) => s.admissionNo === admNo);
        if (student && row[scoreKey] !== undefined && row[scoreKey] !== "") {
          newScores[student.id] = row[scoreKey];
          matched++;
        } else if (admNo) {
          unmatched.push(admNo);
        }
      });
      setScores(newScores);
      setExcelSummary(
        `Loaded ${matched} score(s) from the file.` +
          (unmatched.length ? ` Could not match: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? "…" : ""}` : " Review below, then click Save scores.")
      );
    } catch {
      setExcelError("Could not read that file — make sure it's a valid .xlsx file.");
    } finally {
      e.target.value = "";
    }
  }

  async function loadReportCard() {
    if (!reportStudentId || !reportExamId) return;
    const { data } = await client.get(`/grades/report-card/${reportStudentId}/${reportExamId}`);
    setReportCard(data);
  }

  async function downloadReportCardPdf() {
    if (!reportStudentId || !reportExamId) return;
    const res = await client.get(`/grades/report-card/${reportStudentId}/${reportExamId}/pdf`, {
      responseType: "blob",
    });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const link = document.createElement("a");
    const disposition = res.headers["content-disposition"] || "";
    const match = disposition.match(/filename="(.+)"/);
    link.href = url;
    link.download = match ? match[1] : "report-card.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function downloadClassReportCardsPdf() {
    if (!classRoomId || !reportExamId) return;
    const res = await client.get(`/grades/report-cards/class/${classRoomId}/${reportExamId}/pdf`, {
      responseType: "blob",
    });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const link = document.createElement("a");
    const disposition = res.headers["content-disposition"] || "";
    const match = disposition.match(/filename="(.+)"/);
    link.href = url;
    link.download = match ? match[1] : "report-cards.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-10">
      {isAdmin && (
        <div>
          <h2 className="text-2xl font-display font-semibold mb-6">Subjects &amp; teacher assignments</h2>

          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg font-semibold">Subjects</h3>
            <button
              className="btn-secondary text-sm"
              onClick={() => {
                if (showSubjectForm) {
                  setShowSubjectForm(false);
                  setEditingSubjectId(null);
                  setSubjectForm({ name: "", code: "" });
                } else {
                  setShowSubjectForm(true);
                }
              }}
            >
              {showSubjectForm ? "Cancel" : "+ New subject"}
            </button>
          </div>
          {showSubjectForm && (
            <form onSubmit={handleCreateSubject} className="card p-4 mb-4 flex gap-3 items-end">
              {editingSubjectId && (
                <p className="text-xs uppercase tracking-wider text-slate/50 font-mono self-center">Editing</p>
              )}
              <div>
                <label className="block text-xs font-medium mb-1">Subject name</label>
                <input
                  className="input"
                  required
                  placeholder="e.g. Kiswahili"
                  value={subjectForm.name}
                  onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Code</label>
                <input
                  className="input"
                  required
                  placeholder="e.g. KIS"
                  value={subjectForm.code}
                  onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })}
                />
              </div>
              <button className="btn-primary" type="submit">{editingSubjectId ? "Save changes" : "Save subject"}</button>
              {subjectError && <p className="text-rust text-sm">{subjectError}</p>}
            </form>
          )}
          <div className="flex flex-wrap gap-2 mb-8">
            {subjects.map((s) => (
              <button key={s.id} className="pill border border-line bg-white hover:border-ink" onClick={() => handleEditSubject(s)} title="Click to edit">
                {s.name} <span className="text-slate/40">· {s.code}</span>
              </button>
            ))}
            {subjects.length === 0 && <p className="text-slate/50 text-sm">No subjects yet — add one above.</p>}
          </div>

          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg font-semibold">Assign teachers to subjects</h3>
            <div className="flex gap-3 items-center">
              <select className="input" value={classRoomId} onChange={(e) => setClassRoomId(e.target.value)}>
                {classRooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="btn-secondary text-sm whitespace-nowrap" onClick={() => setShowAssignForm((v) => !v)}>
                {showAssignForm ? "Cancel" : "+ New assignment"}
              </button>
            </div>
          </div>
          {showAssignForm && (
            <form onSubmit={handleAssignTeacher} className="card p-4 mb-4 flex gap-3 items-end">
              <div>
                <label className="block text-xs font-medium mb-1">Subject</label>
                <select
                  className="input"
                  required
                  value={assignForm.subjectId}
                  onChange={(e) => setAssignForm({ ...assignForm, subjectId: e.target.value })}
                >
                  <option value="">Select subject</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Teacher</label>
                <select
                  className="input"
                  required
                  value={assignForm.teacherId}
                  onChange={(e) => setAssignForm({ ...assignForm, teacherId: e.target.value })}
                >
                  <option value="">Select teacher</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
                </select>
              </div>
              <button className="btn-primary" type="submit">Save assignment</button>
              {assignError && <p className="text-rust text-sm">{assignError}</p>}
            </form>
          )}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                  <th className="py-2 px-4">Subject</th>
                  <th className="py-2 px-4">Teacher</th>
                  <th className="py-2 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {classSubjects.map((cs) => (
                  <tr key={cs.id} className="border-b border-line/60">
                    <td className="py-2 px-4">{cs.subject.name}</td>
                    <td className="py-2 px-4">{cs.teacher.firstName} {cs.teacher.lastName}</td>
                    <td className="py-2 px-4">
                      <button className="text-xs text-rust underline underline-offset-2" onClick={() => handleRemoveAssignment(cs.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {classSubjects.length === 0 && (
                  <tr><td colSpan={3} className="py-4 px-4 text-center text-slate/50">No subjects assigned to this class yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canEnter && (
        <div>
          <h2 className="text-2xl font-display font-semibold mb-6">Enter grades</h2>
          <div className="flex gap-3 mb-4 items-start">
            <select className="input" value={classRoomId} onChange={(e) => setClassRoomId(e.target.value)}>
              {classRooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input" value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">Select exam</option>
              {exams.map((ex) => <option key={ex.id} value={ex.id}>{ex.name} (Term {ex.term}, {ex.year})</option>)}
            </select>
            <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Select subject</option>
              {availableSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button
              className="btn-secondary whitespace-nowrap"
              onClick={() => {
                if (showExamForm) {
                  setShowExamForm(false);
                } else {
                  setExamForm((f) => ({ ...f, classRoomIds: classRoomId ? [Number(classRoomId)] : [] }));
                  setShowExamForm(true);
                }
              }}
            >
              {showExamForm ? "Cancel" : "+ New exam"}
            </button>
          </div>
          {!isAdmin && availableSubjects.length === 0 && (
            <p className="text-slate/50 text-sm mb-4">You haven't been assigned any subjects for this class yet — ask an admin to assign you one.</p>
          )}

          {showExamForm && (
            <form onSubmit={handleCreateExam} className="card p-4 mb-4">
              <div className="flex gap-3 items-end flex-wrap mb-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Exam name</label>
                  <input
                    className="input"
                    required
                    placeholder="e.g. End Term Exam"
                    value={examForm.name}
                    onChange={(e) => setExamForm({ ...examForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Term</label>
                  <select className="input" value={examForm.term} onChange={(e) => setExamForm({ ...examForm, term: e.target.value })}>
                    <option value="1">Term 1</option>
                    <option value="2">Term 2</option>
                    <option value="3">Term 3</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Year</label>
                  <input
                    className="input w-24"
                    type="number"
                    required
                    value={examForm.year}
                    onChange={(e) => setExamForm({ ...examForm, year: e.target.value })}
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-xs font-medium mb-2">Which classes are sitting this exam? *</label>
                <div className="flex flex-wrap gap-2">
                  {classRooms.map((c) => (
                    <label
                      key={c.id}
                      className={`pill border cursor-pointer select-none ${
                        examForm.classRoomIds.includes(c.id) ? "border-ink bg-ink text-paper" : "border-line bg-white text-slate/70"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={examForm.classRoomIds.includes(c.id)}
                        onChange={() => toggleExamClass(c.id)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
              <button className="btn-primary" type="submit">Create exam</button>
              {examError && <p className="text-rust text-sm mt-2">{examError}</p>}
            </form>
          )}

          <div className="card overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                  <th className="py-2 px-4">Exam</th>
                  <th className="py-2 px-4">Term</th>
                  <th className="py-2 px-4">Year</th>
                  <th className="py-2 px-4">Status</th>
                  {isAdmin && <th className="py-2 px-4"></th>}
                </tr>
              </thead>
              <tbody>
                {exams.map((ex) =>
                  editingExamId === ex.id ? (
                    <tr key={ex.id} className="border-b border-line/60 bg-line/10">
                      <td colSpan={isAdmin ? 5 : 4} className="py-3 px-4">
                        <form onSubmit={handleSaveExamEdit} className="flex gap-3 items-end flex-wrap">
                          <div>
                            <label className="block text-xs font-medium mb-1">Exam name</label>
                            <input className="input" required value={examEditForm.name} onChange={(e) => setExamEditForm({ ...examEditForm, name: e.target.value })} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1">Term</label>
                            <select className="input" value={examEditForm.term} onChange={(e) => setExamEditForm({ ...examEditForm, term: e.target.value })}>
                              <option value="1">Term 1</option>
                              <option value="2">Term 2</option>
                              <option value="3">Term 3</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1">Year</label>
                            <input className="input w-24" type="number" required value={examEditForm.year} onChange={(e) => setExamEditForm({ ...examEditForm, year: e.target.value })} />
                          </div>
                          <button className="btn-primary text-sm" type="submit">Save</button>
                          <button className="btn-secondary text-sm" type="button" onClick={() => setEditingExamId(null)}>Cancel</button>
                          {examEditError && <p className="text-rust text-sm w-full">{examEditError}</p>}
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={ex.id} className="border-b border-line/60">
                      <td className="py-2 px-4">{ex.name}</td>
                      <td className="py-2 px-4">Term {ex.term}</td>
                      <td className="py-2 px-4">{ex.year}</td>
                      <td className="py-2 px-4">
                        {ex.published ? (
                          <span className="pill border border-moss/30 bg-moss/10 text-moss">Published</span>
                        ) : (
                          <span className="pill border border-amber/30 bg-amber/10 text-amber">Draft</span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="py-2 px-4 whitespace-nowrap">
                          <button className="text-xs text-ink underline underline-offset-2 mr-3" onClick={() => handleEditExam(ex)}>
                            Edit
                          </button>
                          <button className="text-xs text-ink underline underline-offset-2 mr-3" onClick={() => handleTogglePublish(ex)}>
                            {ex.published ? "Unpublish" : "Publish"}
                          </button>
                          <button className="text-xs text-rust underline underline-offset-2" onClick={() => handleDeleteExam(ex)}>
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                )}
                {exams.length === 0 && (
                  <tr><td colSpan={isAdmin ? 5 : 4} className="py-4 px-4 text-center text-slate/50">No exams for this class yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {examId && subjectId && (
            <div className="card overflow-x-auto">
              <div className="p-4 border-b border-line flex items-center gap-4 flex-wrap">
                <label className="btn-secondary text-sm cursor-pointer">
                  Upload scores from Excel
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
                </label>
                <span className="text-xs text-slate/40">Columns: "Admission No" and "Score"</span>
                <div className="flex items-center gap-2 ml-auto">
                  <label className="text-xs font-medium text-slate/60 whitespace-nowrap">Maximum mark</label>
                  <input
                    className="input w-20"
                    type="number"
                    min={1}
                    value={maxScore}
                    onChange={(e) => setMaxScore(e.target.value)}
                  />
                </div>
              </div>
              {excelError && <p className="text-rust text-sm px-4 pt-3">{excelError}</p>}
              {excelSummary && <p className="text-moss text-sm px-4 pt-3">{excelSummary}</p>}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                    <th className="py-3 px-4 font-mono">Adm. No</th>
                    <th className="py-3 px-4">Student</th>
                    <th className="py-3 px-4 w-32">Score / {maxScore || 100}</th>
                    <th className="py-3 px-4 w-20">%</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const raw = scores[s.id];
                    const pct = raw !== undefined && raw !== "" && Number(maxScore) > 0
                      ? ((Number(raw) / Number(maxScore)) * 100).toFixed(1)
                      : null;
                    return (
                      <tr key={s.id} className="border-b border-line/60">
                        <td className="py-2 px-4 font-mono text-xs text-slate/60">{s.admissionNo}</td>
                        <td className="py-2 px-4">{s.firstName} {s.lastName}</td>
                        <td className="py-2 px-4">
                          <input
                            className="input"
                            type="number"
                            min={0}
                            max={Number(maxScore) || 100}
                            value={raw ?? ""}
                            onChange={(e) => setScores({ ...scores, [s.id]: e.target.value })}
                          />
                        </td>
                        <td className="py-2 px-4 text-slate/50 font-mono text-xs">{pct != null ? `${pct}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="p-4 flex items-center gap-3">
                <button className="btn-primary" onClick={handleSaveScores}>Save scores</button>
                {saved && <span className="text-moss text-sm">Saved.</span>}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="text-2xl font-display font-semibold mb-6">Report card</h2>
        <div className="flex gap-2 mb-4">
          <button
            className={`pill border cursor-pointer ${printMode === "individual" ? "border-ink bg-ink text-paper" : "border-line bg-white text-slate/70"}`}
            onClick={() => setPrintMode("individual")}
          >
            Individual student
          </button>
          <button
            className={`pill border cursor-pointer ${printMode === "class" ? "border-ink bg-ink text-paper" : "border-line bg-white text-slate/70"}`}
            onClick={() => setPrintMode("class")}
          >
            Entire class
          </button>
        </div>

        {printMode === "individual" ? (
          <div className="flex gap-3 mb-4">
            <select className="input" value={reportStudentId} onChange={(e) => setReportStudentId(e.target.value)}>
              <option value="">Select student</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
            </select>
            <select className="input" value={reportExamId} onChange={(e) => setReportExamId(e.target.value)}>
              <option value="">Select exam</option>
              {exams.map((ex) => <option key={ex.id} value={ex.id}>{ex.name} (Term {ex.term}, {ex.year})</option>)}
            </select>
            <button className="btn-secondary" onClick={loadReportCard}>View</button>
          </div>
        ) : (
          <div className="flex gap-3 mb-4 items-end">
            <div>
              <label className="block text-xs font-medium mb-1">Class</label>
              <select className="input" value={classRoomId} onChange={(e) => setClassRoomId(e.target.value)}>
                {classRooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Exam</label>
              <select className="input" value={reportExamId} onChange={(e) => setReportExamId(e.target.value)}>
                <option value="">Select exam</option>
                {exams.map((ex) => <option key={ex.id} value={ex.id}>{ex.name} (Term {ex.term}, {ex.year})</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={!reportExamId} onClick={downloadClassReportCardsPdf}>
              Download all report cards (PDF)
            </button>
          </div>
        )}

        {printMode === "individual" && reportCard && (
          <div className="card p-6">
            <div className="flex justify-between items-start mb-6 pb-4 border-b border-line">
              <div>
                <h3 className="font-display text-xl font-semibold">{reportCard.student.name}</h3>
                <p className="text-slate/60 text-sm">{reportCard.student.classRoom} · {reportCard.exam.name}, Term {reportCard.exam.term} {reportCard.exam.year}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-slate/50 font-mono">Overall</p>
                <p className="text-3xl font-display font-semibold text-ink mb-2">{reportCard.average}% · {reportCard.overallGrade}</p>
                <button className="btn-secondary text-sm" onClick={downloadReportCardPdf}>
                  Download PDF
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line">
                  <th className="py-2">Subject</th>
                  <th className="py-2">Score</th>
                  <th className="py-2">%</th>
                  <th className="py-2">Grade</th>
                  <th className="py-2">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {reportCard.subjects.map((subj, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <td className="py-2">{subj.subject}</td>
                    <td className="py-2">{subj.score}/{subj.maxScore}</td>
                    <td className="py-2">{subj.percentage}%</td>
                    <td className="py-2 font-medium">{subj.grade}</td>
                    <td className="py-2 text-slate/60">{subj.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
