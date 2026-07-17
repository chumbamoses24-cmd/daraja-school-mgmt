import { useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_STYLES = {
  PRESENT: "bg-moss/10 text-moss border-moss/30",
  LATE: "bg-amber/10 text-amber border-amber/30",
  ABSENT: "bg-rust/10 text-rust border-rust/30",
  EXCUSED: "bg-slate/10 text-slate border-slate/30",
};

export default function Attendance() {
  const { user } = useAuth();
  const canMark = user.role === "ADMIN" || user.role === "TEACHER";

  const [classRooms, setClassRooms] = useState([]);
  const [classRoomId, setClassRoomId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [students, setStudents] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [records, setRecords] = useState([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    client.get("/students/classrooms").then((r) => {
      setClassRooms(r.data);
      if (r.data.length) setClassRoomId(String(r.data[0].id));
    });
  }, []);

  useEffect(() => {
    if (canMark && classRoomId) {
      client.get(`/students?classRoomId=${classRoomId}`).then((r) => {
        setStudents(r.data);
        const init = {};
        r.data.forEach((s) => (init[s.id] = "PRESENT"));
        setStatuses(init);
      });
    } else if (!canMark) {
      client.get("/attendance").then((r) => setRecords(r.data));
    }
  }, [canMark, classRoomId]);

  async function handleSave() {
    setSaved(false);
    const recordsPayload = Object.entries(statuses).map(([studentId, status]) => ({
      studentId: Number(studentId),
      status,
    }));
    await client.post("/attendance", { classRoomId: Number(classRoomId), date, records: recordsPayload });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (!canMark) {
    return (
      <div>
        <h2 className="text-2xl font-display font-semibold mb-6">Attendance history</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-b border-line/60">
                  <td className="py-3 px-4">{new Date(r.date).toLocaleDateString()}</td>
                  <td className="py-3 px-4">{r.student.firstName} {r.student.lastName}</td>
                  <td className="py-3 px-4">
                    <span className={`pill border ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
              {records.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-slate/50">No records yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-display font-semibold">Mark attendance</h2>
        <div className="flex gap-3">
          <select className="input" value={classRoomId} onChange={(e) => setClassRoomId(e.target.value)}>
            {classRooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
              <th className="py-3 px-4 font-mono">Adm. No</th>
              <th className="py-3 px-4">Name</th>
              <th className="py-3 px-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-b border-line/60">
                <td className="py-3 px-4 font-mono text-xs text-slate/60">{s.admissionNo}</td>
                <td className="py-3 px-4 font-medium">{s.firstName} {s.lastName}</td>
                <td className="py-3 px-4">
                  <div className="flex gap-1.5">
                    {["PRESENT", "LATE", "ABSENT", "EXCUSED"].map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setStatuses({ ...statuses, [s.id]: opt })}
                        className={`pill border ${statuses[s.id] === opt ? STATUS_STYLES[opt] : "border-line text-slate/40"}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {students.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-slate/50">No students in this class.</td></tr>}
          </tbody>
        </table>
      </div>

      {students.length > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <button className="btn-primary" onClick={handleSave}>Save register</button>
          {saved && <span className="text-moss text-sm">Saved.</span>}
        </div>
      )}
    </div>
  );
}
