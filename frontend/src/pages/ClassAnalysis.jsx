import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import client from "../api/client";

function GradeDistributionTable({ distribution }) {
  const grades = Object.keys(distribution);
  const total = Object.values(distribution).reduce((s, v) => s + v, 0);
  return (
    <div className="flex flex-wrap gap-2">
      {grades.map((g) => (
        <div key={g} className="pill border border-line bg-white">
          {g}: <span className="font-mono">{distribution[g]}</span>
          {total > 0 && <span className="text-slate/40"> ({Math.round((distribution[g] / total) * 100)}%)</span>}
        </div>
      ))}
    </div>
  );
}

export default function ClassAnalysis() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [examAnalysis, setExamAnalysis] = useState(null);
  const [examAnalysisError, setExamAnalysisError] = useState("");
  const [showGenderSplit, setShowGenderSplit] = useState(false);

  useEffect(() => {
    client
      .get(`/students/classrooms/${id}/analysis`)
      .then((r) => setData(r.data))
      .catch((err) => setError(err.response?.data?.error || "Could not load class analysis"));
    client.get(`/grades/exams?classRoomId=${id}`).then((r) => {
      setExams(r.data);
      if (r.data.length) setExamId(String(r.data[0].id));
    });
  }, [id]);

  useEffect(() => {
    if (!examId) return;
    setExamAnalysisError("");
    client
      .get(`/grades/exam-analysis/${id}/${examId}`)
      .then((r) => setExamAnalysis(r.data))
      .catch((err) => setExamAnalysisError(err.response?.data?.error || "Could not load exam analysis"));
  }, [id, examId]);

  async function downloadExamPdf(kind, defaultName) {
    const res = await client.get(`/grades/exam-analysis/${id}/${examId}/${kind}/pdf`, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const link = document.createElement("a");
    const disposition = res.headers["content-disposition"] || "";
    const match = disposition.match(/filename="(.+)"/);
    link.href = url;
    link.download = match ? match[1] : defaultName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  if (error) return <p className="text-rust">{error}</p>;
  if (!data) return <p className="text-slate/50">Loading…</p>;

  return (
    <div>
      <Link to="/" className="text-sm text-slate/50 hover:underline mb-4 inline-block">← Back to dashboard</Link>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-display font-semibold">{data.classRoom.name}</h2>
          <p className="text-slate/60 text-sm">
            {data.classRoom.level}{data.classRoom.stream ? ` · ${data.classRoom.stream}` : ""} · {data.classRoom.teacher || "No homeroom teacher"}
          </p>
        </div>
        <Link to="/students" className="btn-secondary text-sm">View student list</Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-2">Students</p>
          <p className="text-3xl font-display font-semibold text-ink">{data.studentCount}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-2">Attendance rate</p>
          <p className="text-3xl font-display font-semibold text-ink">
            {data.classAttendanceRate != null ? `${data.classAttendanceRate}%` : "—"}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-2">Overall average (all exams)</p>
          <p className="text-3xl font-display font-semibold text-ink">
            {data.classOverallAverage != null ? `${data.classOverallAverage}%` : "—"}
          </p>
        </div>
      </div>

      {/* ---- Exam-specific analysis ---- */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-display text-lg font-semibold">Exam analysis</h3>
          <select className="input w-auto" value={examId} onChange={(e) => setExamId(e.target.value)}>
            {exams.map((ex) => <option key={ex.id} value={ex.id}>{ex.name} (Term {ex.term}, {ex.year})</option>)}
          </select>
        </div>

        {exams.length === 0 && <p className="text-slate/50 text-sm">No exams recorded for this class yet.</p>}
        {examAnalysisError && <p className="text-rust text-sm">{examAnalysisError}</p>}

        {examAnalysis && (
          <>
            <div className="flex flex-wrap gap-3 mb-6">
              <button className="btn-secondary text-sm" onClick={() => downloadExamPdf("merit-list", "merit-list.pdf")}>
                Download Merit List
              </button>
              <button className="btn-secondary text-sm" onClick={() => downloadExamPdf("subjects-report", "subject-analysis.pdf")}>
                Download Subject Analysis Report
              </button>
              <button className="btn-secondary text-sm" onClick={() => downloadExamPdf("top10", "top-10.pdf")}>
                Download Top 10 Students
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="card p-4">
                <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-1">Subjects</p>
                <p className="text-2xl font-display font-semibold text-ink">{examAnalysis.subjectCount}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-1">Total marks</p>
                <p className="text-2xl font-display font-semibold text-ink">{examAnalysis.totalMarks}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-1">Mean score</p>
                <p className="text-2xl font-display font-semibold text-ink">
                  {examAnalysis.classMeanScore != null ? `${examAnalysis.classMeanScore}%` : "—"}
                </p>
              </div>
              <div className="card p-4">
                <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-1">Mean points</p>
                <p className="text-2xl font-display font-semibold text-ink">
                  {examAnalysis.classMeanPoints != null ? examAnalysis.classMeanPoints : "—"}
                </p>
              </div>
            </div>

            {/* Subject means, ranked */}
            {examAnalysis.subjects.length > 0 && (
              <div className="card p-6 mb-6">
                <h4 className="font-display text-base font-semibold mb-4">Subject mean & rank</h4>
                <div className="space-y-3">
                  {examAnalysis.subjects.map((s) => (
                    <div key={s.subject} className="flex items-center gap-3">
                      <span className="font-mono text-xs text-slate/40 w-6">#{s.rank}</span>
                      <span className="text-sm w-32 truncate">{s.subject}</span>
                      <div className="flex-1 h-2 bg-line/30 rounded-full overflow-hidden">
                        <div className="h-full bg-ink rounded-full" style={{ width: `${s.mean}%` }} />
                      </div>
                      <span className="text-sm font-mono w-12 text-right">{s.mean}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Gender comparison */}
            <div className="card p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-display text-base font-semibold">Boys vs. girls</h4>
                <button className="text-xs text-ink underline underline-offset-2" onClick={() => setShowGenderSplit((v) => !v)}>
                  {showGenderSplit ? "Hide grade distribution by gender" : "Show grade distribution by gender"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-1">Boys ({examAnalysis.genderComparison.boys.count})</p>
                  <p className="text-2xl font-display font-semibold text-ink">
                    {examAnalysis.genderComparison.boys.meanScore != null ? `${examAnalysis.genderComparison.boys.meanScore}%` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-1">Girls ({examAnalysis.genderComparison.girls.count})</p>
                  <p className="text-2xl font-display font-semibold text-ink">
                    {examAnalysis.genderComparison.girls.meanScore != null ? `${examAnalysis.genderComparison.girls.meanScore}%` : "—"}
                  </p>
                </div>
              </div>
              <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-2">Overall grade distribution</p>
              <GradeDistributionTable distribution={examAnalysis.classDistribution} />

              {showGenderSplit && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-2">Boys</p>
                    <GradeDistributionTable distribution={examAnalysis.classDistributionByGender.Male} />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-2">Girls</p>
                    <GradeDistributionTable distribution={examAnalysis.classDistributionByGender.Female} />
                  </div>
                </div>
              )}

              {showGenderSplit && examAnalysis.subjects.length > 0 && (
                <div className="mt-6 space-y-4">
                  <p className="text-xs uppercase tracking-wider text-slate/50 font-mono">Per-subject distribution by gender</p>
                  {examAnalysis.subjects.map((s) => (
                    <div key={s.subject} className="border-t border-line pt-3">
                      <p className="text-sm font-medium mb-2">{s.subject}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-slate/40 mb-1">Boys</p>
                          <GradeDistributionTable distribution={s.distributionByGender.Male} />
                        </div>
                        <div>
                          <p className="text-xs text-slate/40 mb-1">Girls</p>
                          <GradeDistributionTable distribution={s.distributionByGender.Female} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Merit list */}
            <div className="card overflow-x-auto mb-8">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                    <th className="py-2 px-3">Pos</th>
                    <th className="py-2 px-3">Adm No</th>
                    <th className="py-2 px-3">Name</th>
                    {examAnalysis.subjects.map((s) => (
                      <th key={s.subject} className="py-2 px-3 whitespace-nowrap">{s.subject}</th>
                    ))}
                    <th className="py-2 px-3">Total</th>
                    <th className="py-2 px-3">Mean %</th>
                    <th className="py-2 px-3">Pts</th>
                    <th className="py-2 px-3">Mean Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {examAnalysis.students.map((s) => (
                    <tr key={s.id} className="border-b border-line/60 hover:bg-line/10">
                      <td className="py-2 px-3 font-mono">{s.position ?? "—"}</td>
                      <td className="py-2 px-3 font-mono text-xs text-slate/60">{s.admissionNo}</td>
                      <td className="py-2 px-3">
                        <Link to={`/students/${s.id}`} className="hover:underline text-ink whitespace-nowrap">{s.name}</Link>
                      </td>
                      {s.subjects.map((sub) => (
                        <td key={sub.subject} className="py-2 px-3 whitespace-nowrap">
                          {sub.score != null ? `${sub.score} (${sub.grade})` : "—"}
                        </td>
                      ))}
                      <td className="py-2 px-3 font-mono">{s.totalScore}</td>
                      <td className="py-2 px-3 font-mono">{s.meanScore != null ? `${s.meanScore}%` : "—"}</td>
                      <td className="py-2 px-3 font-mono">{s.totalPoints}</td>
                      <td className="py-2 px-3 font-mono">{s.meanPoints ?? "—"}</td>
                    </tr>
                  ))}
                  {examAnalysis.students.length === 0 && (
                    <tr><td colSpan={7 + examAnalysis.subjects.length} className="py-6 text-center text-slate/50">No students in this class yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="card overflow-x-auto">
        <h3 className="font-display text-lg font-semibold p-6 pb-0">Attendance & performance across all exams</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
              <th className="py-3 px-4 font-mono">Adm. No</th>
              <th className="py-3 px-4">Name</th>
              <th className="py-3 px-4">Attendance</th>
              <th className="py-3 px-4">Average</th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.id} className="border-b border-line/60 hover:bg-line/10">
                <td className="py-3 px-4 font-mono text-xs text-slate/60">{s.admissionNo}</td>
                <td className="py-3 px-4 font-medium">
                  <Link to={`/students/${s.id}`} className="hover:underline text-ink">{s.name}</Link>
                </td>
                <td className="py-3 px-4">{s.attendanceRate != null ? `${s.attendanceRate}%` : "—"}</td>
                <td className="py-3 px-4">{s.average != null ? `${s.average}%` : "—"}</td>
              </tr>
            ))}
            {data.students.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-slate/50">No students in this class yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
