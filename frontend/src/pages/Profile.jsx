import { useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

export default function Profile() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await client.put("/auth/me", { firstName, lastName, phone });
      const updated = { ...user, firstName: data.firstName, lastName: data.lastName, phone: data.phone };
      localStorage.setItem("user", JSON.stringify(updated));
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.error || "Could not update profile.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md">
      <h2 className="text-2xl font-display font-semibold mb-6">My profile</h2>
      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input className="input bg-line/20 text-slate/50" value={user?.email || ""} disabled />
          <p className="text-xs text-slate/40 mt-1">Email can't be changed here — contact an admin if it needs to change.</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">First name</label>
          <input className="input" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Last name</label>
          <input className="input" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0700000000" />
        </div>
        {error && <p className="text-rust text-sm">{error}</p>}
        <div className="flex items-center gap-3">
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "Saving…" : "Save changes"}
          </button>
          {saved && <span className="text-moss text-sm">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
