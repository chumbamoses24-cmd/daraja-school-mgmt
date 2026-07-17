import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

export default function StudentProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [classRooms, setClassRooms] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  function load() {
    client.get(`/students/${id}`).then((r) => {
      setStudent(r.data);
      setForm({
        admissionNo: r.data.admissionNo,
        firstName: r.data.firstName,
        lastName: r.data.lastName,
        classRoomId: r.data.classRoomId ? String(r.data.classRoomId) : "",
        dob: r.data.dob ? r.data.dob.slice(0, 10) : "",
        gender: r.data.gender || "",
        guardianName: r.data.guardianName || "",
        guardianPhone: r.data.guardianPhone || "",
        guardianEmail: r.data.guardianEmail || "",
      });
    });
    client.get("/students/classrooms").then((r) => setClassRooms(r.data));
  }
  useEffect(load, [id]);

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await client.put(`/students/${id}`, { ...form, classRoomId: form.classRoomId ? Number(form.classRoomId) : undefined });
      setSaved(true);
      load();
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.error?.formErrors?.join(", ") || "Could not save changes");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${student.firstName} ${student.lastName}? This removes their attendance, grades, and fee records too. This cannot be undone.`)) return;
    await client.delete(`/students/${id}`);
    navigate("/students");
  }

  if (!student || !form) return <p className="text-slate/50">Loading…</p>;

  const canEdit = user.role === "ADMIN";

  return (
    <div className="max-w-2xl">
      <Link to="/students" className="text-sm text-slate/50 hover:underline mb-4 inline-block">← Back to students</Link>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-display font-semibold">{student.firstName} {student.lastName}</h2>
        {canEdit && (
          <button className="text-sm text-rust underline underline-offset-2" onClick={handleDelete}>
            Delete student
          </button>
        )}
      </div>

      <form onSubmit={handleSave} className="card p-6 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Admission No. *</label>
          <input
            className="input disabled:bg-line/20 disabled:text-slate/50"
            required
            disabled={!canEdit}
            value={form.admissionNo}
            onChange={(e) => setForm({ ...form, admissionNo: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Class / Stream *</label>
          <select
            className="input disabled:bg-line/20 disabled:text-slate/50"
            required
            disabled={!canEdit}
            value={form.classRoomId}
            onChange={(e) => setForm({ ...form, classRoomId: e.target.value })}
          >
            <option value="">Select a class</option>
            {classRooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">First name *</label>
          <input
            className="input disabled:bg-line/20 disabled:text-slate/50"
            required
            disabled={!canEdit}
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Last name *</label>
          <input
            className="input disabled:bg-line/20 disabled:text-slate/50"
            required
            disabled={!canEdit}
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date of birth</label>
          <input
            className="input disabled:bg-line/20 disabled:text-slate/50"
            type="date"
            disabled={!canEdit}
            value={form.dob}
            onChange={(e) => setForm({ ...form, dob: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Gender</label>
          <select
            className="input disabled:bg-line/20 disabled:text-slate/50"
            disabled={!canEdit}
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
          >
            <option value="">Not specified</option>
            <option>Male</option>
            <option>Female</option>
          </select>
        </div>

        <div className="col-span-2 pt-2 border-t border-line">
          <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-3">Guardian contact</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Guardian name</label>
          <input
            className="input disabled:bg-line/20 disabled:text-slate/50"
            disabled={!canEdit}
            value={form.guardianName}
            onChange={(e) => setForm({ ...form, guardianName: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Guardian phone</label>
          <input
            className="input disabled:bg-line/20 disabled:text-slate/50"
            disabled={!canEdit}
            value={form.guardianPhone}
            onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">Guardian email</label>
          <input
            className="input disabled:bg-line/20 disabled:text-slate/50"
            type="email"
            disabled={!canEdit}
            value={form.guardianEmail}
            onChange={(e) => setForm({ ...form, guardianEmail: e.target.value })}
          />
        </div>

        {error && <p className="text-rust text-sm col-span-2">{error}</p>}
        {canEdit && (
          <div className="col-span-2 flex items-center gap-3">
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save changes"}
            </button>
            {saved && <span className="text-moss text-sm">Saved.</span>}
          </div>
        )}
      </form>
    </div>
  );
}
