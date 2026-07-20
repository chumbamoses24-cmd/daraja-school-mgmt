import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const emptyForm = {
  admissionNo: "",
  firstName: "",
  lastName: "",
  dob: "",
  gender: "",
  classRoomId: "",
  guardianName: "",
  guardianPhone: "",
  guardianEmail: "",
  photo: "",
};
const emptyClassForm = { level: "", stream: "", name: "", teacherId: "" };
const STREAM_SUGGESTIONS = ["East", "West", "North", "South", "Red", "Blue", "Green", "Yellow"];

// Resizes/compresses an image file client-side before storing it as base64, so photos stay small.
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

export default function Students() {
  const { user } = useAuth();
  const [students, setStudents] = useState([]);
  const [classRooms, setClassRooms] = useState([]);
  const [levels, setLevels] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [photoError, setPhotoError] = useState("");

  const [classForm, setClassForm] = useState(emptyClassForm);
  const [showClassForm, setShowClassForm] = useState(false);
  const [editingClassId, setEditingClassId] = useState(null);
  const [classError, setClassError] = useState("");

  function load() {
    client.get("/students").then((r) => setStudents(r.data));
    client.get("/students/classrooms").then((r) => setClassRooms(r.data));
    client.get("/students/classrooms/levels").then((r) => setLevels(r.data)).catch(() => {});
    if (user.role === "ADMIN") {
      client.get("/auth/users?role=TEACHER").then((r) => setTeachers(r.data)).catch(() => {});
    }
  }
  useEffect(load, []);

  // Keep the display name in sync with level + stream as the admin types, unless they're editing an
  // existing class whose name doesn't follow that pattern (then leave it alone).
  function updateClassField(field, value) {
    setClassForm((f) => {
      const next = { ...f, [field]: value };
      if (field === "level" || field === "stream") {
        next.name = [next.level, next.stream].filter(Boolean).join(" ");
      }
      return next;
    });
  }

  async function handleAddClass(e) {
    e.preventDefault();
    setClassError("");
    try {
      const payload = {
        name: classForm.name || classForm.level,
        level: classForm.level,
        stream: classForm.stream || undefined,
        teacherId: classForm.teacherId ? Number(classForm.teacherId) : null,
      };
      if (editingClassId) {
        await client.put(`/students/classrooms/${editingClassId}`, payload);
      } else {
        await client.post("/students/classrooms", payload);
      }
      setClassForm(emptyClassForm);
      setEditingClassId(null);
      setShowClassForm(false);
      load();
    } catch (err) {
      setClassError(err.response?.data?.error?.formErrors?.join(", ") || "Could not save class");
    }
  }

  function handleEditClass(classRoom) {
    setEditingClassId(classRoom.id);
    setClassForm({
      level: classRoom.level,
      stream: classRoom.stream || "",
      name: classRoom.name,
      teacherId: classRoom.teacher?.id ? String(classRoom.teacher.id) : "",
    });
    setShowClassForm(true);
  }

  async function handleDeleteClass(classRoom) {
    if (!window.confirm(`Delete "${classRoom.name}"? Its students will be kept but unassigned from any class.`)) return;
    try {
      await client.delete(`/students/classrooms/${classRoom.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Could not delete class");
    }
  }

  async function handleDeleteStudent(student) {
    if (!window.confirm(`Delete ${student.firstName} ${student.lastName}? This removes their attendance, grades, and fee records too. This cannot be undone.`)) return;
    try {
      await client.delete(`/students/${student.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Could not delete student");
    }
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

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await client.post("/students", { ...form, classRoomId: Number(form.classRoomId) });
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error?.formErrors?.join(", ") || "Could not add student");
    }
  }

  function downloadClassExcel(groupName, groupStudents) {
    const rows = groupStudents.map((s) => ({
      "Adm No": s.admissionNo,
      Name: `${s.firstName} ${s.lastName}`,
      Gender: s.gender || "",
      "Guardian": s.guardianName || (s.parent ? `${s.parent.firstName} ${s.parent.lastName}` : ""),
      "Guardian Phone": s.guardianPhone || s.parent?.phone || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Class List");
    XLSX.writeFile(wb, `${groupName.replace(/\s+/g, "-").toLowerCase()}-class-list.xlsx`);
  }

  async function downloadClassPdf(classRoomId, groupName) {
    const res = await client.get(`/students/classrooms/${classRoomId}/pdf`, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${groupName.replace(/\s+/g, "-").toLowerCase()}-class-list.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div>
      {user.role === "ADMIN" && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg font-semibold">Classes</h3>
            <button
              className="btn-secondary text-sm"
              onClick={() => {
                if (showClassForm) {
                  setShowClassForm(false);
                  setEditingClassId(null);
                  setClassForm(emptyClassForm);
                } else {
                  setShowClassForm(true);
                }
              }}
            >
              {showClassForm ? "Cancel" : "+ New class"}
            </button>
          </div>

          {showClassForm && (
            <form onSubmit={handleAddClass} className="card p-6 mb-4 grid grid-cols-2 gap-4">
              {editingClassId && (
                <p className="col-span-2 text-xs uppercase tracking-wider text-slate/50 font-mono">Editing class</p>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">Level *</label>
                <input
                  className="input"
                  required
                  list="level-suggestions"
                  placeholder="e.g. Grade 7"
                  value={classForm.level}
                  onChange={(e) => updateClassField("level", e.target.value)}
                />
                <datalist id="level-suggestions">
                  {levels.map((l) => <option key={l} value={l} />)}
                </datalist>
                <p className="text-xs text-slate/40 mt-1">Reuse an existing level to add another stream under it, or type a new one.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Stream</label>
                <input
                  className="input"
                  list="stream-suggestions"
                  placeholder="e.g. East (optional)"
                  value={classForm.stream}
                  onChange={(e) => updateClassField("stream", e.target.value)}
                />
                <datalist id="stream-suggestions">
                  {STREAM_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Display name</label>
                <input
                  className="input"
                  required
                  placeholder="Auto-filled from level + stream"
                  value={classForm.name}
                  onChange={(e) => setClassForm({ ...classForm, name: e.target.value })}
                />
                <p className="text-xs text-slate/40 mt-1">Feel free to override this if you'd like a custom name.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Homeroom teacher</label>
                <select
                  className="input"
                  value={classForm.teacherId}
                  onChange={(e) => setClassForm({ ...classForm, teacherId: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>
                  ))}
                </select>
              </div>
              {classError && <p className="text-rust text-sm col-span-2">{classError}</p>}
              <button className="btn-primary col-span-2" type="submit">
                {editingClassId ? "Save changes" : "Save class"}
              </button>
            </form>
          )}

          <div className="flex flex-wrap gap-2">
            {classRooms.map((c) => (
              <span key={c.id} className="pill border border-line bg-white flex items-center gap-2">
                <button className="hover:underline text-left" onClick={() => handleEditClass(c)} title="Edit class">
                  {c.name}
                </button>
                <span className="text-slate/40">
                  · {c._count?.students ?? 0} students · {c.teacher ? `${c.teacher.firstName} ${c.teacher.lastName}` : "no teacher"}
                </span>
                <button className="text-rust hover:underline" onClick={() => handleDeleteClass(c)} title="Delete class">
                  ×
                </button>
              </span>
            ))}
            {classRooms.length === 0 && <p className="text-slate/50 text-sm">No classes yet — add one above.</p>}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-display font-semibold">{user.role === "PARENT" ? "My Children" : "Students & Admissions"}</h2>
        {user.role === "ADMIN" && (
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ New admission"}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 mb-6 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Admission No. *</label>
            <input className="input" required value={form.admissionNo} onChange={(e) => setForm({ ...form, admissionNo: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Class / Stream *</label>
            <select className="input" required value={form.classRoomId} onChange={(e) => setForm({ ...form, classRoomId: e.target.value })}>
              <option value="">Select a class</option>
              {classRooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">First name *</label>
            <input className="input" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Last name *</label>
            <input className="input" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Date of birth</label>
            <input className="input" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Gender</label>
            <select className="input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="">Not specified</option>
              <option>Male</option>
              <option>Female</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Passport photo (optional)</label>
            <div className="flex items-center gap-4">
              {form.photo && <img src={form.photo} alt="Preview" className="w-16 h-16 rounded object-cover border border-line" />}
              <input className="input" type="file" accept="image/*" onChange={handlePhotoChange} />
            </div>
            {photoError && <p className="text-rust text-xs mt-1">{photoError}</p>}
          </div>
          <div className="col-span-2 pt-2 border-t border-line">
            <p className="text-xs uppercase tracking-wider text-slate/50 font-mono mb-3">Guardian contact (optional — can be added later)</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Guardian name</label>
            <input
              className="input"
              placeholder="e.g. Peter Kamau"
              value={form.guardianName}
              onChange={(e) => setForm({ ...form, guardianName: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Guardian phone</label>
            <input
              className="input"
              placeholder="0712345678"
              value={form.guardianPhone}
              onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Guardian email</label>
            <input
              className="input"
              type="email"
              placeholder="parent@example.com"
              value={form.guardianEmail}
              onChange={(e) => setForm({ ...form, guardianEmail: e.target.value })}
            />
          </div>
          {error && <p className="text-rust text-sm col-span-2">{error}</p>}
          <button className="btn-primary col-span-2" type="submit">Save student</button>
        </form>
      )}

      {(() => {
        const groups = {};
        students.forEach((s) => {
          const key = s.classRoom?.name || "Unassigned";
          if (!groups[key]) groups[key] = { classRoomId: s.classRoom?.id || null, students: [] };
          groups[key].students.push(s);
        });
        const groupNames = Object.keys(groups).sort((a, b) => {
          if (a === "Unassigned") return 1;
          if (b === "Unassigned") return -1;
          return a.localeCompare(b);
        });
        groupNames.forEach((name) => {
          groups[name].students.sort((a, b) =>
            a.admissionNo.localeCompare(b.admissionNo, undefined, { numeric: true, sensitivity: "base" })
          );
        });

        if (students.length === 0) {
          return <p className="text-slate/50 text-center py-10">No students found.</p>;
        }

        return groupNames.map((groupName) => (
          <div key={groupName} className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-lg font-semibold">
                {groupName} <span className="text-slate/40 text-sm font-body font-normal">· {groups[groupName].students.length} students</span>
              </h3>
              {groups[groupName].classRoomId && (
                <div className="flex gap-3">
                  <button
                    className="text-xs text-ink underline underline-offset-2"
                    onClick={() => downloadClassPdf(groups[groupName].classRoomId, groupName)}
                  >
                    Download PDF
                  </button>
                  <button
                    className="text-xs text-ink underline underline-offset-2"
                    onClick={() => downloadClassExcel(groupName, groups[groupName].students)}
                  >
                    Download Excel
                  </button>
                </div>
              )}
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                    <th className="py-3 px-4"></th>
                    <th className="py-3 px-4 font-mono">Adm. No</th>
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Gender</th>
                    <th className="py-3 px-4">Guardian</th>
                    <th className="py-3 px-4">Guardian phone</th>
                    {user.role === "ADMIN" && <th className="py-3 px-4"></th>}
                  </tr>
                </thead>
                <tbody>
                  {groups[groupName].students.map((s) => (
                    <tr key={s.id} className="border-b border-line/60 hover:bg-line/10">
                      <td className="py-2 px-4">
                        {s.photo ? (
                          <img src={s.photo} alt="" className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-line/40" />
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate/60">{s.admissionNo}</td>
                      <td className="py-3 px-4 font-medium">
                        <Link to={`/students/${s.id}`} className="hover:underline text-ink">
                          {s.firstName} {s.lastName}
                        </Link>
                      </td>
                      <td className="py-3 px-4">{s.gender || "—"}</td>
                      <td className="py-3 px-4">{s.guardianName || (s.parent ? `${s.parent.firstName} ${s.parent.lastName}` : "—")}</td>
                      <td className="py-3 px-4">{s.guardianPhone || s.parent?.phone || "—"}</td>
                      {user.role === "ADMIN" && (
                        <td className="py-3 px-4">
                          <button className="text-xs text-rust underline underline-offset-2" onClick={() => handleDeleteStudent(s)}>
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ));
      })()}
    </div>
  );
}
