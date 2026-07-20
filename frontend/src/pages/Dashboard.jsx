import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function StatCard({ label, value, tone = "ink" }) {
  const toneClasses = {
    ink: "text-ink",
    moss: "text-moss",
    rust: "text-rust",
    amber: "text-amber",
  };
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-2">{label}</p>
      <p className={`text-3xl font-display font-semibold ${toneClasses[tone]}`}>{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [students, setStudents] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [messages, setMessages] = useState([]);
  const [classRooms, setClassRooms] = useState([]);

  useEffect(() => {
    client.get("/students").then((r) => setStudents(r.data)).catch(() => {});
    if (user.role !== "TEACHER") client.get("/fees/invoices").then((r) => setInvoices(r.data)).catch(() => {});
    client.get("/messages/inbox").then((r) => setMessages(r.data)).catch(() => {});
    if (user.role !== "PARENT") client.get("/students/classrooms").then((r) => setClassRooms(r.data)).catch(() => {});
  }, [user.role]);

  const unpaidCount = invoices.filter((i) => i.status !== "PAID").length;
  const unreadCount = messages.filter((m) => !m.readAt).length;

  return (
    <div>
      <h2 className="text-2xl font-display font-semibold mb-1">
        Welcome back, {user.firstName}
      </h2>
      <p className="text-slate/60 mb-8 text-sm">
        {new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label={user.role === "PARENT" ? "My Children" : "Students"} value={students.length} />
        {user.role !== "TEACHER" && <StatCard label="Unpaid Invoices" value={unpaidCount} tone={unpaidCount ? "rust" : "moss"} />}
        <StatCard label="Unread Messages" value={unreadCount} tone={unreadCount ? "amber" : "moss"} />
        {user.role === "ADMIN" && <StatCard label="Role" value="Admin" />}
      </div>

      {user.role !== "PARENT" && (
        <div className="mb-8">
          <h3 className="font-display text-lg font-semibold mb-4">Classes</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {classRooms.map((c) => (
              <Link
                key={c.id}
                to={`/classes/${c.id}`}
                className="card p-5 hover:border-ink transition-colors block"
              >
                <p className="font-display text-lg font-semibold">{c.name}</p>
                <p className="text-sm text-slate/50 mb-3">
                  {c.teacher ? `${c.teacher.firstName} ${c.teacher.lastName}` : "No homeroom teacher"}
                </p>
                <p className="text-2xl font-display font-semibold text-ink">{c._count?.students ?? 0}</p>
                <p className="text-xs uppercase tracking-wider text-slate/40 font-mono">students</p>
              </Link>
            ))}
            {classRooms.length === 0 && <p className="text-slate/50 text-sm">No classes yet.</p>}
          </div>
        </div>
      )}

      <div className="card p-6">
        <h3 className="font-display text-lg font-semibold mb-4">
          {user.role === "PARENT" ? "Your children" : "Students at a glance"}
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line">
              <th className="py-2 font-mono">Adm. No</th>
              <th className="py-2">Name</th>
              <th className="py-2">Class</th>
            </tr>
          </thead>
          <tbody>
            {students.slice(0, 8).map((s) => (
              <tr key={s.id} className="border-b border-line/60">
                <td className="py-2 font-mono text-xs text-slate/60">{s.admissionNo}</td>
                <td className="py-2">{s.firstName} {s.lastName}</td>
                <td className="py-2">{s.classRoom?.name || "—"}</td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr><td colSpan={3} className="py-4 text-slate/50 text-center">No students yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
