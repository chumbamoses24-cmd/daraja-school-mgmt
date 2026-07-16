import { useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

export default function Grades() {
  const { user } = useAuth();
  const canEnter = user.role === "ADMIN" || user.role === "TEACHER";

  const [classRooms, setClassRooms] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [exams, setExams] = useState([]);
  const [students, setStudents] = useState([]);

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

  useEffect(() => {
    client.get("/students/classrooms").then((r) => {
      setClassRooms(r.data);
      if (r.data.length) setClassRoomId(String(r.data[0].id));
    });
    client.get("/grades/subjects").then((r) => setSubjects(r.data));
    client.get("/students").then((r) => setStudents(r.data));
  }, []);

  useEffect(() => {
    refreshExams();
  }, [classRoomId]);

  useEffect(() => {
    if (canEnter && classRoomId) client.get(`/students?classRoomId=${classRoomId}`).then((r) => setStudents(r.data));
  }, [canEnter, classRoomId]);

  function refreshExams() {
    if (classRoomId) client.get(`/grades/exams?classRoomId=${classRoomId}`).then((r) => setExams(r.data));
  }

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
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn-secondary whitespace-nowrap" onClick={() => setShowExamForm((v) => !v)}>
              {showExamForm ? "Cancel" : "+ New exam"}
            </button>
          </div>

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
            <div className="card overflow-hidden">
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
