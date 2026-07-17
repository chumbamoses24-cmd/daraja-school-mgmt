import { useEffect, useState } from "react";
import client from "../api/client";

const emptyForm = { email: "", password: "", role: "TEACHER", firstName: "", lastName: "", phone: "" };
const emptyEditForm = { firstName: "", lastName: "", phone: "", email: "", role: "TEACHER" };

function randomTempPassword() {
  return Math.random().toString(36).slice(-8) + "A1";
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ ...emptyForm, password: randomTempPassword() });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [lastCreated, setLastCreated] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editError, setEditError] = useState("");

  function load() {
    client.get("/auth/users").then((r) => setUsers(r.data));
  }
  useEffect(load, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await client.post("/auth/users", form);
      setLastCreated({ identifier: form.email || form.phone, password: form.password });
      setForm({ ...emptyForm, password: randomTempPassword() });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error?.formErrors?.join(", ") || err.response?.data?.error || "Could not create user");
    }
  }

  async function handleDelete(userToDelete) {
    if (!window.confirm(`Delete ${userToDelete.firstName} ${userToDelete.lastName}? This cannot be undone.`)) return;
    try {
      await client.delete(`/auth/users/${userToDelete.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Could not delete user");
    }
  }

  function startEdit(u) {
    setEditingId(u.id);
    setEditForm({ firstName: u.firstName, lastName: u.lastName, phone: u.phone || "", email: u.email || "", role: u.role });
    setEditError("");
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    setEditError("");
    try {
      await client.put(`/auth/users/${editingId}`, editForm);
      setEditingId(null);
      load();
    } catch (err) {
      setEditError(err.response?.data?.error?.formErrors?.join(", ") || err.response?.data?.error || "Could not save changes");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-display font-semibold">Users</h2>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New user"}
        </button>
      </div>

      {lastCreated && (
        <div className="card p-4 mb-6 border-moss/40 bg-moss/5">
          <p className="text-sm">
            Account created for <strong>{lastCreated.identifier}</strong>. Temporary password:{" "}
            <span className="font-mono bg-white px-2 py-0.5 rounded border border-line">{lastCreated.password}</span>
          </p>
          <p className="text-xs text-slate/50 mt-1">Share this with them directly — they'll be required to set their own password on first login.</p>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 mb-6 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Phone *</label>
            <input className="input" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0700000000" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="TEACHER">Teacher</option>
              <option value="PARENT">Parent</option>
              <option value="ADMIN">Admin</option>
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
            <label className="block text-sm font-medium mb-1">Email (optional — can add later)</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Temporary password *</label>
            <input className="input font-mono" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <p className="text-xs text-slate/40 mt-1">Auto-generated — feel free to edit it. They'll be forced to change it on first login.</p>
          </div>
          {error && <p className="text-rust text-sm col-span-2">{error}</p>}
          <button className="btn-primary col-span-2" type="submit">Create account</button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
              <th className="py-3 px-4">Name</th>
              <th className="py-3 px-4">Email</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">Phone</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) =>
              editingId === u.id ? (
                <tr key={u.id} className="border-b border-line/60 bg-line/10">
                  <td colSpan={6} className="py-3 px-4">
                    <form onSubmit={handleSaveEdit} className="grid grid-cols-5 gap-3 items-end">
                      <div>
                        <label className="block text-xs font-medium mb-1">First name</label>
                        <input className="input" required value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Last name</label>
                        <input className="input" required value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Phone</label>
                        <input className="input" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Email</label>
                        <input className="input" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Role</label>
                        <select className="input" value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                          <option value="TEACHER">Teacher</option>
                          <option value="PARENT">Parent</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      </div>
                      {editError && <p className="text-rust text-sm col-span-5">{editError}</p>}
                      <div className="col-span-5 flex gap-3">
                        <button className="btn-primary text-sm" type="submit">Save</button>
                        <button className="btn-secondary text-sm" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={u.id} className="border-b border-line/60">
                  <td className="py-3 px-4 font-medium">{u.firstName} {u.lastName}</td>
                  <td className="py-3 px-4 text-slate/60">{u.email || "—"}</td>
                  <td className="py-3 px-4">{u.role}</td>
                  <td className="py-3 px-4">{u.phone || "—"}</td>
                  <td className="py-3 px-4">
                    {u.mustChangePassword ? (
                      <span className="pill border border-amber/30 bg-amber/10 text-amber">Awaiting first login</span>
                    ) : (
                      <span className="pill border border-moss/30 bg-moss/10 text-moss">Active</span>
                    )}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <button className="text-xs text-ink underline underline-offset-2 mr-3" onClick={() => startEdit(u)}>
                      Edit
                    </button>
                    <button className="text-xs text-rust underline underline-offset-2" onClick={() => handleDelete(u)}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}
            {users.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate/50">No users found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
