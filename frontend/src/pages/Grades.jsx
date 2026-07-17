import { useEffect, useState } from "react";
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
  const [saved, setSaved] = useState(false);

  const [reportStudentId, setReportStudentId] = useState("");
  const [reportExamId, setReportExamId] = useState("");
  const [reportCard, setReportCard] = useState(null);

  const [showExamForm, setShowExamForm] = useState(false);
  const [examForm, setExamForm] = useState({ name: "", term: "1", year: String(new Date().getFullYear()) });
  const [examError, setExamError] = useState("");

  const [showSubjectForm, setShowSubjectForm] = useState(false);
  const [subjectForm, setSubjectForm] = useState({ name: "", code: "" });
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
      await client.post("/grades/subjects", subjectForm);
      setSubjectForm({ name: "", code: "" });
      setShowSubjectForm(false);
      refreshSubjects();
    } catch (err) {
      setSubjectError(err.response?.data?.error?.formErrors?.join(", ") || "Could not create subject");
    }
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

  // Teachers only see subjects they're assigned to teach for the selected class.
  const availableSubjects = isAdmin
    ? subjects
    : subjects.filter((s) => classSubjects.some((cs) => cs.subject.id === s.id && cs.teacher.id === user.id));

  async function handleCreateExam(e) {
    e.preventDefault();
    setExamError("");
    try {
      const { data } = await client.post("/grades/exams", {
        name: examForm.name,
        term: Number(examForm.term),
        year: Number(examForm.year),
        classRoomId: Number(classRoomId),
      });
      setExamForm({ name: "", term: "1", year: String(new Date().getFullYear()) });
      setShowExamForm(false);
      refreshExams();
      setExamId(String(data.id));
    } catch (err) {
      setExamError(err.response?.data?.error?.formErrors?.join(", ") || "Could not create exam");
    }
  }

  async function handleSaveScores() {
    const records = Object.entries(scores).map(([studentId, score]) => ({ studentId: Number(studentId), score: Number(score) }));
    await client.post("/grades", { examId: Number(examId), subjectId: Number(subjectId), records });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
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

  return (
    <div className="space-y-10">
      {isAdmin && (
        <div>
          <h2 className="text-2xl font-display font-semibold mb-6">Subjects &amp; teacher assignments</h2>

          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg font-semibold">Subjects</h3>
            <button className="btn-secondary text-sm" onClick={() => setShowSubjectForm((v) => !v)}>
              {showSubjectForm ? "Cancel" : "+ New subject"}
            </button>
          </div>
          {showSubjectForm && (
            <form onSubmit={handleCreateSubject} className="card p-4 mb-4 flex gap-3 items-end">
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
              <button className="btn-primary" type="submit">Save subject</button>
              {subjectError && <p className="text-rust text-sm">{subjectError}</p>}
            </form>
          )}
          <div className="flex flex-wrap gap-2 mb-8">
            {subjects.map((s) => (
              <span key={s.id} className="pill border border-line bg-white">{s.name} <span className="text-slate/40">· {s.code}</span></span>
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
            <button className="btn-secondary whitespace-nowrap" onClick={() => setShowExamForm((v) => !v)}>
              {showExamForm ? "Cancel" : "+ New exam"}
            </button>
          </div>
          {!isAdmin && availableSubjects.length === 0 && (
            <p className="text-slate/50 text-sm mb-4">You haven't been assigned any subjects for this class yet — ask an admin to assign you one.</p>
          )}

          {showExamForm && (
            <form onSubmit={handleCreateExam} className="card p-4 mb-4 flex gap-3 items-end">
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
              <button className="btn-primary" type="submit">Create exam</button>
              {examError && <p className="text-rust text-sm">{examError}</p>}
            </form>
          )}

          {examId && subjectId && (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                    <th className="py-3 px-4">Student</th>
                    <th className="py-3 px-4 w-40">Score / 100</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} className="border-b border-line/60">
                      <td className="py-2 px-4">{s.firstName} {s.lastName}</td>
                      <td className="py-2 px-4">
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={100}
                          value={scores[s.id] ?? ""}
                          onChange={(e) => setScores({ ...scores, [s.id]: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
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

        {reportCard && (
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
