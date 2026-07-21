import { useEffect, useState } from "react";
import client from "../api/client";
import { useSchool } from "../context/SchoolContext.jsx";

const emptyBandForm = { grade: "", minPercent: "", maxPercent: "", points: "" };

export default function Settings() {
  const { schoolName, refreshSchool } = useSchool();
  const [name, setName] = useState(schoolName);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  const [bands, setBands] = useState([]);
  const [showBandForm, setShowBandForm] = useState(false);
  const [bandForm, setBandForm] = useState(emptyBandForm);
  const [editingBandId, setEditingBandId] = useState(null);
  const [bandError, setBandError] = useState("");

  function loadBands() {
    client.get("/grades/grading-system").then((r) => setBands(r.data));
  }
  useEffect(loadBands, []);

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

  function startAddBand() {
    setEditingBandId(null);
    setBandForm(emptyBandForm);
    setShowBandForm(true);
  }

  function startEditBand(band) {
    setEditingBandId(band.id);
    setBandForm({
      grade: band.grade,
      minPercent: String(band.minPercent),
      maxPercent: String(band.maxPercent),
      points: String(band.points),
    });
    setShowBandForm(true);
  }

  async function handleSaveBand(e) {
    e.preventDefault();
    setBandError("");
    const payload = {
      grade: bandForm.grade,
      minPercent: Number(bandForm.minPercent),
      maxPercent: Number(bandForm.maxPercent),
      points: Number(bandForm.points),
      order: editingBandId ? undefined : bands.length + 1,
    };
    try {
      if (editingBandId) {
        await client.put(`/grades/grading-system/${editingBandId}`, payload);
      } else {
        await client.post("/grades/grading-system", payload);
      }
      setShowBandForm(false);
      setBandForm(emptyBandForm);
      setEditingBandId(null);
      loadBands();
    } catch (err) {
      setBandError(err.response?.data?.error?.formErrors?.join(", ") || "Could not save grade band");
    }
  }

  async function handleDeleteBand(band) {
    if (!window.confirm(`Delete grade "${band.grade}"? Report cards will fall back to the next closest band for scores in this range.`)) return;
    await client.delete(`/grades/grading-system/${band.id}`);
    loadBands();
  }

  return (
    <div className="max-w-2xl space-y-10">
      <div>
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

      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-display font-semibold">Grading system</h2>
            <p className="text-sm text-slate/60 mt-1">Used to compute grade letters, points, and exam analysis across the app.</p>
          </div>
          <button className="btn-secondary text-sm whitespace-nowrap" onClick={startAddBand}>
            + New grade band
          </button>
        </div>

        {showBandForm && (
          <form onSubmit={handleSaveBand} className="card p-4 mb-4 flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-xs font-medium mb-1">Grade</label>
              <input className="input w-20" required placeholder="A" value={bandForm.grade} onChange={(e) => setBandForm({ ...bandForm, grade: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Min %</label>
              <input className="input w-24" type="number" step="0.01" required value={bandForm.minPercent} onChange={(e) => setBandForm({ ...bandForm, minPercent: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Max %</label>
              <input className="input w-24" type="number" step="0.01" required value={bandForm.maxPercent} onChange={(e) => setBandForm({ ...bandForm, maxPercent: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Points</label>
              <input className="input w-20" type="number" required value={bandForm.points} onChange={(e) => setBandForm({ ...bandForm, points: e.target.value })} />
            </div>
            <button className="btn-primary" type="submit">{editingBandId ? "Save changes" : "Add band"}</button>
            <button className="btn-secondary" type="button" onClick={() => setShowBandForm(false)}>Cancel</button>
            {bandError && <p className="text-rust text-sm w-full">{bandError}</p>}
          </form>
        )}

        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                <th className="py-2 px-4">Grade</th>
                <th className="py-2 px-4">Range</th>
                <th className="py-2 px-4">Points</th>
                <th className="py-2 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b.id} className="border-b border-line/60">
                  <td className="py-2 px-4 font-semibold">{b.grade}</td>
                  <td className="py-2 px-4 font-mono text-xs">{b.minPercent}% – {b.maxPercent}%</td>
                  <td className="py-2 px-4 font-mono">{b.points}</td>
                  <td className="py-2 px-4">
                    <button className="text-xs text-ink underline underline-offset-2 mr-3" onClick={() => startEditBand(b)}>Edit</button>
                    <button className="text-xs text-rust underline underline-offset-2" onClick={() => handleDeleteBand(b)}>Delete</button>
                  </td>
                </tr>
              ))}
              {bands.length === 0 && (
                <tr><td colSpan={4} className="py-4 px-4 text-center text-slate/50">No grade bands yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
