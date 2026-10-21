import { useEffect, useMemo, useState } from "react";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_STYLES = {
  PAID: "bg-moss/10 text-moss border-moss/30",
  PARTIAL: "bg-amber/10 text-amber border-amber/30",
  UNPAID: "bg-rust/10 text-rust border-rust/30",
};

const emptyStructureForm = { classRoomId: "", term: "1", year: String(new Date().getFullYear()), amount: "", description: "" };
const emptyInvoiceForm = { studentId: "", term: "1", year: String(new Date().getFullYear()), amountDue: "" };

export default function Fees() {
  const { user } = useAuth();
  const isAdmin = user.role === "ADMIN";
  const [invoices, setInvoices] = useState([]);
  const [structures, setStructures] = useState([]);
  const [classRooms, setClassRooms] = useState([]);
  const [students, setStudents] = useState([]);
  const [payForm, setPayForm] = useState({});

  const [showStructureForm, setShowStructureForm] = useState(false);
  const [structureForm, setStructureForm] = useState(emptyStructureForm);
  const [structureError, setStructureError] = useState("");
  const [generatingId, setGeneratingId] = useState(null);
  const [generatedMsg, setGeneratedMsg] = useState("");

  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm);
  const [invoiceError, setInvoiceError] = useState("");

  // Inline editing — one structure and one invoice at a time.
  const [editingStructure, setEditingStructure] = useState(null); // { id, amount, term, year, description, updateInvoices }
  const [editingInvoice, setEditingInvoice] = useState(null); // { id, amountDue, term, year }
  const [editError, setEditError] = useState("");

  // Invoices are shown collapsed: Level (Grade 7/8/9) -> Stream -> learners. Nothing is open until clicked.
  const [openKeys, setOpenKeys] = useState(new Set());
  const [termFilter, setTermFilter] = useState("ALL");
  function toggleOpen(key) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const termOptions = useMemo(() => {
    const seen = new Map();
    invoices.forEach((i) => seen.set(`${i.year}-${i.term}`, { year: i.year, term: i.term }));
    return [...seen.entries()].sort((a, b) => b[1].year - a[1].year || b[1].term - a[1].term);
  }, [invoices]);

  const groups = useMemo(() => {
    const visible = invoices.filter((i) => termFilter === "ALL" || `${i.year}-${i.term}` === termFilter);
    const levels = new Map();
    for (const inv of visible) {
      const c = inv.student.classRoom;
      const levelName = c?.level || "No class (graduated / unassigned)";
      const streamKey = c ? `c${c.id}` : "none";
      const streamName = c ? c.stream || c.name : "Graduated / unassigned";
      if (!levels.has(levelName)) levels.set(levelName, { name: levelName, streams: new Map(), due: 0, paid: 0, count: 0 });
      const lvl = levels.get(levelName);
      if (!lvl.streams.has(streamKey)) lvl.streams.set(streamKey, { key: streamKey, name: streamName, invoices: [], due: 0, paid: 0 });
      const st = lvl.streams.get(streamKey);
      st.invoices.push(inv);
      st.due += inv.amountDue;
      st.paid += inv.amountPaid;
      lvl.due += inv.amountDue;
      lvl.paid += inv.amountPaid;
      lvl.count += 1;
    }
    const levelNo = (n) => {
      const m = n.match(/\d+/);
      return m ? Number(m[0]) : 999;
    };
    return [...levels.values()]
      .sort((a, b) => levelNo(a.name) - levelNo(b.name) || a.name.localeCompare(b.name))
      .map((l) => ({ ...l, streams: [...l.streams.values()].sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [invoices, termFilter]);

  function load() {
    client.get("/fees/invoices").then((r) => setInvoices(r.data));
    if (isAdmin) {
      client.get("/fees/structures").then((r) => setStructures(r.data));
      client.get("/students/classrooms").then((r) => setClassRooms(r.data));
      client.get("/students").then((r) => setStudents(r.data));
    }
  }
  useEffect(load, []);

  async function recordPayment(invoiceId) {
    const amount = Number(payForm[invoiceId]);
    if (!amount) return;
    await client.post("/fees/payments", { invoiceId, amount, method: "Cash" });
    setPayForm({ ...payForm, [invoiceId]: "" });
    load();
  }

  async function handleCreateStructure(e) {
    e.preventDefault();
    setStructureError("");
    try {
      await client.post("/fees/structures", {
        classRoomId: Number(structureForm.classRoomId),
        term: Number(structureForm.term),
        year: Number(structureForm.year),
        amount: Number(structureForm.amount),
        description: structureForm.description || undefined,
      });
      setStructureForm(emptyStructureForm);
      setShowStructureForm(false);
      load();
    } catch (err) {
      setStructureError(err.response?.data?.error?.formErrors?.join(", ") || "Could not create fee structure");
    }
  }

  async function handleGenerateInvoices(structureId) {
    setGeneratingId(structureId);
    setGeneratedMsg("");
    try {
      const { data } = await client.post("/fees/invoices/generate", { feeStructureId: structureId });
      setGeneratedMsg(`Created ${data.created} invoice(s).${data.skipped ? ` Skipped ${data.skipped} who already had one.` : ""}`);
      load();
    } catch (err) {
      setGeneratedMsg(err.response?.data?.error || "Could not generate invoices");
    } finally {
      setGeneratingId(null);
      setTimeout(() => setGeneratedMsg(""), 4000);
    }
  }

  async function saveStructureEdit() {
    setEditError("");
    const e = editingStructure;
    if (e.updateInvoices && !window.confirm("This will also reset the amount due on every existing invoice for this class and term to the new amount. Payments already recorded are kept. Continue?")) return;
    try {
      const { data } = await client.put(`/fees/structures/${e.id}`, {
        amount: Number(e.amount),
        term: Number(e.term),
        year: Number(e.year),
        description: e.description || null,
        updateInvoices: e.updateInvoices,
      });
      setEditingStructure(null);
      setGeneratedMsg(e.updateInvoices ? `Fee structure saved. ${data.invoicesUpdated} invoice(s) updated.` : "Fee structure saved.");
      setTimeout(() => setGeneratedMsg(""), 4000);
      load();
    } catch (err) {
      setEditError(err.response?.data?.error?.formErrors?.join(", ") || err.response?.data?.error || "Could not save changes");
    }
  }

  async function saveInvoiceEdit() {
    setEditError("");
    const e = editingInvoice;
    try {
      await client.put(`/fees/invoices/${e.id}`, { amountDue: Number(e.amountDue), term: Number(e.term), year: Number(e.year) });
      setEditingInvoice(null);
      load();
    } catch (err) {
      setEditError(err.response?.data?.error?.formErrors?.join(", ") || err.response?.data?.error || "Could not save changes");
    }
  }

  async function handleCreateInvoice(e) {
    e.preventDefault();
    setInvoiceError("");
    try {
      await client.post("/fees/invoices", {
        studentId: Number(invoiceForm.studentId),
        term: Number(invoiceForm.term),
        year: Number(invoiceForm.year),
        amountDue: Number(invoiceForm.amountDue),
      });
      setInvoiceForm(emptyInvoiceForm);
      setShowInvoiceForm(false);
      load();
    } catch (err) {
      setInvoiceError(err.response?.data?.error?.formErrors?.join(", ") || "Could not create invoice");
    }
  }

  function renderInvoiceRow(inv) {
    const ed = editingInvoice?.id === inv.id ? editingInvoice : null;
    return (
      <tr key={inv.id} className="border-b border-line/60">
        <td className="py-3 px-4">
          <span className="font-mono text-xs text-slate/50 mr-2">{inv.student.admissionNo}</span>
          {inv.student.firstName} {inv.student.lastName}
        </td>
        <td className="py-3 px-4">
          {ed ? (
            <div className="flex gap-1">
              <select className="input w-20" value={ed.term} onChange={(e) => setEditingInvoice({ ...ed, term: e.target.value })}>
                <option value="1">T1</option><option value="2">T2</option><option value="3">T3</option>
              </select>
              <input className="input w-20" type="number" value={ed.year} onChange={(e) => setEditingInvoice({ ...ed, year: e.target.value })} />
            </div>
          ) : `T${inv.term} ${inv.year}`}
        </td>
        <td className="py-3 px-4 font-mono">
          {ed ? (
            <input className="input w-28" type="number" min="0" value={ed.amountDue} onChange={(e) => setEditingInvoice({ ...ed, amountDue: e.target.value })} />
          ) : inv.amountDue.toLocaleString()}
        </td>
        <td className="py-3 px-4 font-mono">{inv.amountPaid.toLocaleString()}</td>
        <td className="py-3 px-4 font-mono">{(inv.amountDue - inv.amountPaid).toLocaleString()}</td>
        <td className="py-3 px-4"><span className={`pill border ${STATUS_STYLES[inv.status]}`}>{inv.status}</span></td>
        <td className="py-3 px-4">
          <div className="flex gap-2 items-center flex-wrap">
            {ed ? (
              <>
                <button className="btn-primary text-xs" onClick={saveInvoiceEdit}>Save</button>
                <button className="btn-secondary text-xs" onClick={() => { setEditingInvoice(null); setEditError(""); }}>Cancel</button>
                {editError && <span className="text-rust text-xs">{editError}</span>}
              </>
            ) : (
              <>
                <button className="btn-secondary text-xs" onClick={() => { setEditError(""); setEditingInvoice({ id: inv.id, amountDue: String(inv.amountDue), term: String(inv.term), year: String(inv.year) }); }}>Edit</button>
                {inv.status !== "PAID" && (
                  <>
                    <input
                      className="input w-24"
                      type="number"
                      placeholder="Amount"
                      value={payForm[inv.id] || ""}
                      onChange={(e) => setPayForm({ ...payForm, [inv.id]: e.target.value })}
                    />
                    <button className="btn-secondary" onClick={() => recordPayment(inv.id)}>Record</button>
                  </>
                )}
              </>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-10">
      {isAdmin && (
        <div>
          <h2 className="text-2xl font-display font-semibold mb-6">Fee structures</h2>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate/60">Create a fee amount for a class/term, then generate invoices for every student in that class at once.</p>
            <button className="btn-secondary text-sm whitespace-nowrap" onClick={() => setShowStructureForm((v) => !v)}>
              {showStructureForm ? "Cancel" : "+ New fee structure"}
            </button>
          </div>

          {showStructureForm && (
            <form onSubmit={handleCreateStructure} className="card p-6 mb-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Class</label>
                <select className="input" required value={structureForm.classRoomId} onChange={(e) => setStructureForm({ ...structureForm, classRoomId: e.target.value })}>
                  <option value="">Select a class</option>
                  {classRooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Amount (KES)</label>
                <input className="input" type="number" required value={structureForm.amount} onChange={(e) => setStructureForm({ ...structureForm, amount: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Term</label>
                <select className="input" value={structureForm.term} onChange={(e) => setStructureForm({ ...structureForm, term: e.target.value })}>
                  <option value="1">Term 1</option>
                  <option value="2">Term 2</option>
                  <option value="3">Term 3</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Year</label>
                <input className="input" type="number" required value={structureForm.year} onChange={(e) => setStructureForm({ ...structureForm, year: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">Description (optional)</label>
                <input className="input" placeholder="e.g. Term 2 tuition" value={structureForm.description} onChange={(e) => setStructureForm({ ...structureForm, description: e.target.value })} />
              </div>
              {structureError && <p className="text-rust text-sm col-span-2">{structureError}</p>}
              <button className="btn-primary col-span-2" type="submit">Save fee structure</button>
            </form>
          )}

          <div className="card overflow-x-auto mb-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                  <th className="py-2 px-4">Class</th>
                  <th className="py-2 px-4">Term</th>
                  <th className="py-2 px-4">Amount</th>
                  <th className="py-2 px-4">Description</th>
                  <th className="py-2 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {structures.map((s) => {
                  const ed = editingStructure?.id === s.id ? editingStructure : null;
                  return (
                    <tr key={s.id} className="border-b border-line/60 align-top">
                      <td className="py-2 px-4">{s.classRoom?.name}</td>
                      <td className="py-2 px-4">
                        {ed ? (
                          <div className="flex gap-1">
                            <select className="input w-20" value={ed.term} onChange={(e) => setEditingStructure({ ...ed, term: e.target.value })}>
                              <option value="1">T1</option><option value="2">T2</option><option value="3">T3</option>
                            </select>
                            <input className="input w-20" type="number" value={ed.year} onChange={(e) => setEditingStructure({ ...ed, year: e.target.value })} />
                          </div>
                        ) : `T${s.term} ${s.year}`}
                      </td>
                      <td className="py-2 px-4 font-mono">
                        {ed ? (
                          <input className="input w-28" type="number" min="0" value={ed.amount} onChange={(e) => setEditingStructure({ ...ed, amount: e.target.value })} />
                        ) : s.amount.toLocaleString()}
                      </td>
                      <td className="py-2 px-4 text-slate/60">
                        {ed ? (
                          <div className="space-y-2">
                            <input className="input" value={ed.description} onChange={(e) => setEditingStructure({ ...ed, description: e.target.value })} />
                            <label className="flex items-center gap-2 text-xs text-slate">
                              <input type="checkbox" checked={ed.updateInvoices} onChange={(e) => setEditingStructure({ ...ed, updateInvoices: e.target.checked })} />
                              Also correct the invoices already generated for this class/term
                            </label>
                            {editError && <p className="text-rust text-xs">{editError}</p>}
                          </div>
                        ) : (s.description || "—")}
                      </td>
                      <td className="py-2 px-4 whitespace-nowrap">
                        {ed ? (
                          <div className="flex gap-2">
                            <button className="btn-primary text-xs" onClick={saveStructureEdit}>Save</button>
                            <button className="btn-secondary text-xs" onClick={() => { setEditingStructure(null); setEditError(""); }}>Cancel</button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button className="btn-secondary text-xs" onClick={() => { setEditError(""); setEditingStructure({ id: s.id, amount: String(s.amount), term: String(s.term), year: String(s.year), description: s.description || "", updateInvoices: false }); }}>Edit</button>
                            <button className="btn-secondary text-xs" disabled={generatingId === s.id} onClick={() => handleGenerateInvoices(s.id)}>
                              {generatingId === s.id ? "Generating…" : "Generate invoices"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {structures.length === 0 && (
                  <tr><td colSpan={5} className="py-4 px-4 text-center text-slate/50">No fee structures yet — add one above.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {generatedMsg && <p className="text-sm text-moss">{generatedMsg}</p>}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-display font-semibold">{isAdmin ? "Invoices & Payments" : "Fee Statement"}</h2>
          {isAdmin && (
            <button className="btn-secondary text-sm whitespace-nowrap" onClick={() => setShowInvoiceForm((v) => !v)}>
              {showInvoiceForm ? "Cancel" : "+ Single invoice"}
            </button>
          )}
        </div>

        {showInvoiceForm && (
          <form onSubmit={handleCreateInvoice} className="card p-4 mb-4 flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-xs font-medium mb-1">Student</label>
              <select className="input" required value={invoiceForm.studentId} onChange={(e) => setInvoiceForm({ ...invoiceForm, studentId: e.target.value })}>
                <option value="">Select student</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Amount due (KES)</label>
              <input className="input" type="number" required value={invoiceForm.amountDue} onChange={(e) => setInvoiceForm({ ...invoiceForm, amountDue: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Term</label>
              <select className="input" value={invoiceForm.term} onChange={(e) => setInvoiceForm({ ...invoiceForm, term: e.target.value })}>
                <option value="1">Term 1</option>
                <option value="2">Term 2</option>
                <option value="3">Term 3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Year</label>
              <input className="input w-24" type="number" required value={invoiceForm.year} onChange={(e) => setInvoiceForm({ ...invoiceForm, year: e.target.value })} />
            </div>
            <button className="btn-primary" type="submit">Create invoice</button>
            {invoiceError && <p className="text-rust text-sm">{invoiceError}</p>}
          </form>
        )}

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <label className="text-sm text-slate/60">Show</label>
          <select className="input w-auto" value={termFilter} onChange={(e) => setTermFilter(e.target.value)}>
            <option value="ALL">All terms</option>
            {termOptions.map(([key, t]) => <option key={key} value={key}>Term {t.term} {t.year}</option>)}
          </select>
          <span className="text-xs text-slate/40">Click a grade to see its streams, then a stream to see its learners.</span>
        </div>

        <div className="space-y-3">
          {groups.map((lvl) => {
            const lvlKey = `L:${lvl.name}`;
            const lvlOpen = openKeys.has(lvlKey);
            return (
              <div key={lvlKey} className="card overflow-hidden">
                <button type="button" onClick={() => toggleOpen(lvlKey)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-line/20">
                  <span className="flex items-center gap-3">
                    <span className="text-slate/50 w-4">{lvlOpen ? "▾" : "▸"}</span>
                    <span className="font-display font-semibold text-lg">{lvl.name}</span>
                  </span>
                  <span className="text-xs text-slate/60 text-right">
                    {lvl.count} invoice{lvl.count === 1 ? "" : "s"} · Balance <span className="font-mono">KES {(lvl.due - lvl.paid).toLocaleString()}</span>
                  </span>
                </button>

                {lvlOpen && (
                  <div className="border-t border-line/60 bg-line/10 p-3 space-y-2">
                    {lvl.streams.map((st) => {
                      const stKey = `S:${lvl.name}:${st.key}`;
                      const stOpen = openKeys.has(stKey);
                      return (
                        <div key={stKey} className="bg-white border border-line/60 rounded overflow-hidden">
                          <button type="button" onClick={() => toggleOpen(stKey)} className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-line/20">
                            <span className="flex items-center gap-3">
                              <span className="text-slate/50 w-4">{stOpen ? "▾" : "▸"}</span>
                              <span className="font-medium">{st.name}</span>
                            </span>
                            <span className="text-xs text-slate/60 text-right">
                              {st.invoices.length} invoice{st.invoices.length === 1 ? "" : "s"} · Balance <span className="font-mono">KES {(st.due - st.paid).toLocaleString()}</span>
                            </span>
                          </button>

                          {stOpen && (
                            <div className="overflow-x-auto border-t border-line/60">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                                    <th className="py-2 px-4">Student</th>
                                    <th className="py-2 px-4">Term</th>
                                    <th className="py-2 px-4">Amount Due</th>
                                    <th className="py-2 px-4">Paid</th>
                                    <th className="py-2 px-4">Balance</th>
                                    <th className="py-2 px-4">Status</th>
                                    <th className="py-2 px-4">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>{st.invoices.map(renderInvoiceRow)}</tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {groups.length === 0 && (
            <div className="card py-6 text-center text-slate/50">No invoices found.</div>
          )}
        </div>
      </div>
    </div>
  );
}
