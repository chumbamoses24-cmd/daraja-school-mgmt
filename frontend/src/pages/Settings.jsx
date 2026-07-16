import { useState } from "react";
import client from "../api/client";
import { useSchool } from "../context/SchoolContext.jsx";

export default function Settings() {
  const { schoolName, refreshSchool } = useSchool();
  const [name, setName] = useState(schoolName);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await client.put("/settings", { schoolName: name });
      refreshSchool();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.error || "Could not update school name.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md">
      <h2 className="text-2xl font-display font-semibold mb-6">School settings</h2>
      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">School name</label>
          <input className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <p className="text-xs text-slate/40 mt-1">Shown on the login screen and throughout the app.</p>
        </div>
        {error && <p className="text-rust text-sm">{error}</p>}
        <div className="flex items-center gap-3">
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-moss text-sm">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
