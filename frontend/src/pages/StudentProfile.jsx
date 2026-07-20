import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

function resizeImageToDataUrl(file, maxDimension = 240) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
  const [photoError, setPhotoError] = useState("");

  const [attendanceSummary, setAttendanceSummary] = useState(null);
  const [examAverages, setExamAverages] = useState([]);
  const [overallAverage, setOverallAverage] = useState(null);

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
        photo: r.data.photo || "",
      });
    });
    client.get("/students/classrooms").then((r) => setClassRooms(r.data));
    client.get(`/attendance/summary/${id}`).then((r) => setAttendanceSummary(r.data)).catch(() => {});
    client.get(`/grades?studentId=${id}`).then((r) => {
      const grades = r.data;
      const byExam = {};
      grades.forEach((g) => {
        const key = g.exam.id;
        if (!byExam[key]) byExam[key] = { name: g.exam.name, term: g.exam.term, year: g.exam.year, total: 0, max: 0 };
        byExam[key].total += g.score;
        byExam[key].max += g.maxScore;
      });
      const averages = Object.values(byExam).map((e) => ({
        ...e,
        average: e.max ? Number(((e.total / e.max) * 100).toFixed(1)) : 0,
      }));
      setExamAverages(averages);
      const grandTotal = grades.reduce((s, g) => s + g.score, 0);
      const grandMax = grades.reduce((s, g) => s + g.maxScore, 0);
      setOverallAverage(grandMax ? Number(((grandTotal / grandMax) * 100).toFixed(1)) : null);
    }).catch(() => {});
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

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError("");
    if (!file.type.startsWith("image/")) {
      setPhotoError("Please choose an image file.");
      return;
    }
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setForm((f) => ({ ...f, photo: dataUrl }));
    } catch {
      setPhotoError("Could not process that image.");
    }
  }

  if (!student || !form) return <p className="text-slate/50">Loading…</p>;

  const canEdit = user.role === "ADMIN";

  return (
    <div className="max-w-2xl">
      <Link to="/students" className="text-sm text-slate/50 hover:underline mb-4 inline-block">← Back to students</Link>
      <div className="flex items-center gap-4 mb-6">
        {form.photo ? (
          <img src={form.photo} alt="" className="w-16 h-16 rounded-full object-cover border border-line" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-line/40 flex items-center justify-center text-slate/40 text-xs">No photo</div>
        )}
        <div className="flex-1 flex items-center justify-between">
          <h2 className="text-2xl font-display font-semibold">{student.firstName} {student.lastName}</h2>
          {canEdit && (
            <button className="text-sm text-rust underline underline-offset-2" onClick={handleDelete}>
              Delete student
            </button>
          )}
        </div>
      </div>

      {(attendanceSummary || examAverages.length > 0) && (
        <div className="card p-6 mb-6">
          <h3 className="font-display text-lg font-semibold mb-4">Performance snapshot</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-1">Attendance rate</p>
              <p className="text-2xl font-display font-semibold text-ink">
                {attendanceSummary?.presentRate != null ? `${attendanceSummary.presentRate}%` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-1">Overall average</p>
              <p className="text-2xl font-display font-semibold text-ink">
                {overallAverage != null ? `${overallAverage}%` : "—"}
              </p>
            </div>
          </div>
          {examAverages.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-2">By exam</p>
              {examAverages.map((e, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm w-40 truncate">{e.name} (T{e.term} {e.year})</span>
                  <div className="flex-1 h-2 bg-line/30 rounded-full overflow-hidden">
                    <div className="h-full bg-ink rounded-full" style={{ width: `${e.average}%` }} />
                  </div>
                  <span className="text-sm font-mono w-12 text-right">{e.average}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSave} className="card p-6 grid grid-cols-2 gap-4">
        {canEdit && (
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Passport photo</label>
            <input className="input" type="file" accept="image/*" onChange={handlePhotoChange} />
            {photoError && <p className="text-rust text-xs mt-1">{photoError}</p>}
          </div>
        )}
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
