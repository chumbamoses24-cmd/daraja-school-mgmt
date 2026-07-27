import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import client from "../api/client";

export default function SubjectStatus() {
  const { classRoomId, examId } = useParams();
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState(null);
  const [error, setError] = useState("");
  const [classRoom, setClassRoom] = useState(null);
  const [exam, setExam] = useState(null);

  useEffect(() => {
    client
      .get(`/grades/upload-status/${classRoomId}/${examId}`)
      .then((r) => setSubjects(r.data))
      .catch((err) => setError(err.response?.data?.error || "Could not load subjects for this class/exam"));
    client.get("/students/classrooms").then((r) => setClassRoom(r.data.find((c) => String(c.id) === classRoomId)));
    client.get(`/grades/exams?classRoomId=${classRoomId}`).then((r) => setExam(r.data.find((e) => String(e.id) === examId)));
  }, [classRoomId, examId]);

  return (
    <div>
      <button onClick={() => navigate(-1)} className="text-sm text-slate/50 hover:underline mb-4 inline-block">← Back</button>
      <h2 className="text-2xl font-display font-semibold mb-1">
        {classRoom?.name || "Class"} — {exam?.name || "Exam"}
      </h2>
      <p className="text-slate/60 text-sm mb-6">Pick a subject to view or upload marks.</p>

      {error && <p className="text-rust text-sm">{error}</p>}
      {!error && subjects === null && <p className="text-slate/50 text-sm">Loading…</p>}

      {subjects && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                <th className="py-3 px-4">Subject</th>
                <th className="py-3 px-4">Teacher</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.subjectId} className="border-b border-line/60">
                  <td className="py-3 px-4 font-medium">{s.subjectName}</td>
                  <td className="py-3 px-4 text-slate/60">{s.teacher || "—"}</td>
                  <td className="py-3 px-4">
                    {s.uploaded ? (
                      <span className="pill border border-moss/30 bg-moss/10 text-moss">
                        Uploaded ({s.gradedCount}/{s.totalStudents})
                      </span>
                    ) : (
                      <span className="pill border border-amber/30 bg-amber/10 text-amber">Not uploaded</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Link
                      to={`/grades?classRoomId=${classRoomId}&examId=${examId}&subjectId=${s.subjectId}`}
                      className="btn-secondary text-xs"
                    >
                      {s.uploaded ? "View / Edit marks" : "Upload marks"}
                    </Link>
                  </td>
                </tr>
              ))}
              {subjects.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-slate/50">No subjects assigned to this class yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
