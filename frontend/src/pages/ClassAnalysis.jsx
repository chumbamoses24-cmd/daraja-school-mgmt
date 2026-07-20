import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import client from "../api/client";

export default function ClassAnalysis() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client
      .get(`/students/classrooms/${id}/analysis`)
      .then((r) => setData(r.data))
      .catch((err) => setError(err.response?.data?.error || "Could not load class analysis"));
  }, [id]);

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
          <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-2">Overall average</p>
          <p className="text-3xl font-display font-semibold text-ink">
            {data.classOverallAverage != null ? `${data.classOverallAverage}%` : "—"}
          </p>
        </div>
      </div>

      {data.subjectAverages.length > 0 && (
        <div className="card p-6 mb-8">
          <h3 className="font-display text-lg font-semibold mb-4">Average by subject</h3>
          <div className="space-y-3">
            {data.subjectAverages
              .sort((a, b) => b.average - a.average)
              .map((s) => (
                <div key={s.subject} className="flex items-center gap-3">
                  <span className="text-sm w-32 truncate">{s.subject}</span>
                  <div className="flex-1 h-2 bg-line/30 rounded-full overflow-hidden">
                    <div className="h-full bg-ink rounded-full" style={{ width: `${s.average}%` }} />
                  </div>
                  <span className="text-sm font-mono w-12 text-right">{s.average}%</span>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
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
